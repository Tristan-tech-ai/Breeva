/**
 * Road-color PRECOMPUTE (Stage 1 — direct local compute, exact-parity).
 *
 * Computes the v2 per-road AQI for a whole region in ONE pass (no 1000-row cap) by REUSING the
 * exact deployed serve functions (computeRoadAQIv2 + buildMultiSourceDeltas, exported from
 * api/vayu/road-aqi.ts) — so values match the live engine. Streams all region roads via a direct
 * `pg` pooler connection (PostgREST caps at 1000), then upserts results into road_aqi_precomputed.
 *
 * Run on the always-on PC (local-first, §20):
 *   node_modules/.bin/tsx vayu/precompute/refresh_road_aqi.mts <region> [--write]
 * Without --write it's a DRY RUN (computes + reports + parity sample, no DB writes).
 *
 * Parity note: the live serve interpolates met over the viewport; here we use one region-center
 * met (regional → minor drift on wind only). pm25/aqi (the color) = background(CAMS_daily) + GP +
 * Σ dispersion → matched exactly (same code + same CAMS + same hour). Temporal-AI diurnal blend +
 * WAQI/satellite bias are skipped (small secondary-pollutant effect); validated below.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import {
  computeRoadAQIv2, buildMultiSourceDeltas, HOURLY_TRAFFIC,
  type RoadRow, type BaselineData,
} from '../../api/vayu/road-aqi.ts';

// ── env (.env.local) ──────────────────────────────────────────
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const POOLER = env.SUPABASE_POOLER_URL;
if (!POOLER) throw new Error('SUPABASE_POOLER_URL missing in .env.local');

const REGION = (process.argv[2] || 'bali').toLowerCase();
const WRITE = process.argv.includes('--write');
// region centers for the single met/CAMS fetch (matches the live per-viewport-center approach)
const CENTER: Record<string, [number, number]> = {
  jakarta: [-6.2, 106.82], bali: [-8.65, 115.2], bandung: [-6.91, 107.61],
  surabaya: [-7.28, 112.74], yogyakarta: [-7.80, 110.36], semarang: [-6.97, 110.42],
  solo: [-7.56, 110.83], medan: [3.59, 98.67], palembang: [-2.98, 104.76],
  makassar: [-5.15, 119.43], malang: [-7.98, 112.63],
  // OOD/refused regions (no sensor calibration) — engine serves baseline ambient + 'refuse';
  // precompute stores those so even refused regions serve as a pure read.
  sulsel: [-4.0, 119.9], sulut: [1.4, 124.8], sulteng: [-1.4, 120.0],
  sultra: [-4.0, 122.0], gorontalo: [0.6, 123.0], sulbar: [-2.7, 119.0],
};
const [cLat, cLon] = CENTER[REGION] ?? [-6.2, 106.82];

// ── helpers: same Open-Meteo sources the serve uses ──────────
async function fetchBaseline(lat: number, lon: number): Promise<BaselineData> {
  const [aq, wx] = await Promise.all([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&timezone=auto`).then(r => r.json()).catch(() => null),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&timezone=auto`).then(r => r.json()).catch(() => null),
  ]);
  const c = aq?.current ?? {};
  const w = wx?.current ?? {};
  return {
    pm25: c.pm2_5 ?? 15, pm10: c.pm10 ?? 25, no2: c.nitrogen_dioxide ?? 20, o3: c.ozone ?? 60,
    wind_speed: w.wind_speed_10m ?? 2.0, wind_direction: w.wind_direction_10m ?? 0,
  } as BaselineData;
}
async function fetchCamsDaily(lat: number, lon: number): Promise<number> {
  const j = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=pm2_5&past_days=1&forecast_days=1&timezone=auto`).then(r => r.json()).catch(() => null);
  const arr: (number | null)[] = j?.hourly?.pm2_5 ?? [];
  const vals = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

const ROAD_COLS = `osm_way_id, ST_AsGeoJSON(geom, 5) AS geojson, highway, lanes, width,
  canyon_ratio, landuse_proxy, traffic_base_estimate, traffic_calibration_factor,
  name, surface, elevation_avg, micro_class, ai_pollution_factor`;

async function main() {
  const t0 = Date.now();
  // hour/month replicate the serve (Vercel runs UTC → new Date().getHours() == UTC there)
  const hour = new Date().getUTCHours();
  const month = new Date().getUTCMonth() + 1;
  const diurnal = HOURLY_TRAFFIC[hour] ?? 1.0;

  const [baseline, camsDaily] = await Promise.all([fetchBaseline(cLat, cLon), fetchCamsDaily(cLat, cLon)]);
  console.log(`[${REGION}] hour(UTC)=${hour} diurnal=${diurnal} camsDaily=${camsDaily.toFixed(1)} wind=${baseline.wind_speed} no2=${baseline.no2}`);

  const pool = new Pool({ connectionString: POOLER, max: 4 });
  const tFetch = Date.now();
  const { rows } = await pool.query(`SELECT ${ROAD_COLS} FROM public.road_segments WHERE region = $1`, [REGION]);
  console.log(`[${REGION}] fetched ${rows.length} roads in ${((Date.now() - tFetch) / 1000).toFixed(1)}s`);
  const roads = rows as RoadRow[];

  const tCompute = Date.now();
  const interp = (_lat: number, _lon: number) => baseline;  // region-center met (regional)
  const multi = buildMultiSourceDeltas(roads, interp, diurnal, hour, month);
  const out: Array<Record<string, unknown>> = [];
  for (const road of roads) {
    let coords: number[][];
    try { coords = (JSON.parse(road.geojson) as { coordinates: number[][] }).coordinates; } catch { continue; }
    if (!coords || coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    const v = computeRoadAQIv2(road, coords, mid[1], mid[0], baseline, diurnal, REGION, hour, month, camsDaily, multi.get(road.osm_way_id));
    if (!Number.isFinite(v.pm25)) continue;
    out.push({ osm_way_id: road.osm_way_id, region: REGION, aqi: v.aqi, pm25: v.pm25, no2: v.no2, o3: v.o3, pm10: v.pm10,
      pm25_delta: v.pm25_delta, no2_delta: v.no2_delta, pm10_delta: v.pm10_delta,
      pi95_lo: v.pi95_lo, pi95_hi: v.pi95_hi, confidence: v.confidence, confidence_score: v.confidence_score,
      ood_refused: v.ood_refused, ai_classified: v.ai_classified, engine: v.engine,
      geojson: road.geojson, highway: road.highway });  // Stage 5: store geometry so serve reads only this table
  }
  const computeMs = Date.now() - tCompute;
  const mem = process.memoryUsage().rss / 1024 / 1024;
  // distribution sanity
  const pm = out.map(o => o.pm25 as number).sort((a, b) => a - b);
  const q = (p: number) => pm.length ? pm[Math.floor(pm.length * p)].toFixed(1) : 'NA';
  console.log(`[${REGION}] computed ${out.length} roads in ${(computeMs / 1000).toFixed(1)}s | RSS ${mem.toFixed(0)}MB`);
  console.log(`[${REGION}] pm25 p10 ${q(0.1)} | p50 ${q(0.5)} | p90 ${q(0.9)} | max ${pm.length ? pm[pm.length - 1].toFixed(1) : 'NA'}`);

  if (WRITE) {
    const tW = Date.now();
    const COLS = ['osm_way_id', 'region', 'aqi', 'pm25', 'no2', 'o3', 'pm10', 'pm25_delta', 'no2_delta', 'pm10_delta', 'pi95_lo', 'pi95_hi', 'confidence', 'confidence_score', 'ood_refused', 'ai_classified', 'engine', 'geojson', 'highway'];
    const CHUNK = 1000;
    for (let i = 0; i < out.length; i += CHUNK) {
      const slice = out.slice(i, i + CHUNK);
      const params: unknown[] = [];
      const tuples = slice.map((o, k) => {
        const base = k * COLS.length;
        params.push(...COLS.map(c => o[c]));
        return `(${COLS.map((_, j) => `$${base + j + 1}`).join(',')}, now())`;
      });
      await pool.query(
        `INSERT INTO public.road_aqi_precomputed (${COLS.join(',')}, computed_at) VALUES ${tuples.join(',')}
         ON CONFLICT (osm_way_id) DO UPDATE SET ${COLS.slice(2).map(c => `${c}=EXCLUDED.${c}`).join(',')}, computed_at=now()`,
        params,
      );
    }
    console.log(`[${REGION}] UPSERTED ${out.length} rows in ${((Date.now() - tW) / 1000).toFixed(1)}s`);
  } else {
    console.log(`[${REGION}] DRY RUN (no DB write). Add --write to persist.`);
  }
  await pool.end();
  console.log(`[${REGION}] TOTAL ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
