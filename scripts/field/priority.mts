/**
 * Priority list of schools and health facilities by estimated exposure during their activity hours (task F1-04).
 *
 *   pnpm exec tsx scripts/field/priority.mts --pack <pack.bin> --facilities <fasilitas_jarak.csv> --region bali --tz 8 \
 *        --name badung_denpasar --out public/data/prioritas/badung_denpasar.json
 *
 * Exposure is computed AT each facility (not at the nearest road): CAMS background via Open-Meteo plus vehicle exhaust from
 * the same kernel as the map (src/lib/field/exhaust.ts, iso1: every major road within 500 m and the 40 nearest minor ones,
 * wind from every direction, at least 1 m/s, one half of a dual carriageway carrying half the volume), for every activity
 * hour of the next day (Open-Meteo forecast). Ranked by the exhaust (traffic NOx), the part that differs between facilities
 * and that road measures can change (task F4-03, 17 Nov 2026). A model estimate without station correction; the page says so.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchBaselineGrid } from '../../api/vayu/_baseline.js';
import { computeRoadAQIv2, fetchCamsDailyMean, HOURLY_TRAFFIC, type RoadRow } from '../../api/vayu/road-aqi.js';
import { pasquillClass } from '../../api/vayu/_caline4.js';
import { exhaustAt } from '../../src/lib/field/exhaust.js';
import { RoadPack } from './pack.js';
import { exhaustSources, makeInterp, roadRow, type FieldInputs } from './engine.js';

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

/** Minimal RFC 4180 CSV reader (pandas output: quoted fields may contain commas). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (q) {
      if (ch === '"' && text[k + 1] === '"') { field += '"'; k++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[k + 1] === '\n') k++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
}

/** Activity hours (local, start of each hour) per facility type. */
export const ACTIVITY_HOURS: Record<string, number[]> = {
  school: [7, 8, 9, 10, 11, 12, 13], kindergarten: [7, 8, 9, 10, 11], childcare: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  clinic: [8, 9, 10, 11, 12, 13, 14, 15], hospital: Array.from({ length: 24 }, (_, h) => h),
};

const t0 = Date.now();
const pack = new RoadPack(new Uint8Array(readFileSync(arg('pack'))));
const fac = parseCsv(readFileSync(arg('facilities'), 'utf8'));
const region = arg('region');
const tz = Number(arg('tz'));
const name = arg('name');
const outPath = arg('out');

// Open-Meteo forecast fetched once per URL with 48 hourly steps; each forecast hour is an index into the same arrays.
const memo = new Map<string, string>();
const memoFetch = (async (url: string) => {
  const u = String(url).replace(/forecast_hours=\d+/, 'forecast_hours=48');
  if (!memo.has(u)) {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    memo.set(u, await r.text());
  }
  return new Response(memo.get(u)!);
}) as unknown as typeof fetch;

const now = new Date();
const nowLocal = new Date(now.getTime() + tz * 3600_000);
const tomorrow = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() + 1));
const dateLocal = tomorrow.toISOString().slice(0, 10);
const month = tomorrow.getUTCMonth() + 1;
// forecast offset (hours from the current UTC hour) of local hour h tomorrow
const startUtcHour = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
const fhOf = (h: number) => Math.round((tomorrow.getTime() + (h - tz) * 3600_000 - startUtcHour) / 3600_000);

const [w, s, e, n] = pack.meta.bbox;
const camsDaily = await fetchCamsDailyMean((s + n) / 2, (w + e) / 2, region, dateLocal);
const rows: RoadRow[] = Array.from({ length: pack.n }, (_, k) => roadRow(pack, k));
const neededHours = [...new Set(fac.flatMap((f) => ACTIVITY_HOURS[f.jenis] ?? ACTIVITY_HOURS.school))].sort((a, b) => a - b);
const noCache = { redisGet: async () => null, redisSetEx: async () => {}, ttlSec: 0, fetchImpl: memoFetch };
const coordsAll = rows.map((_, k) => pack.coords(k));
const sourceMemo = new Map<number, ReturnType<typeof exhaustSources>>();
const sources = (diurnal: number) => {
  let s = sourceMemo.get(diurnal);
  if (!s) { s = exhaustSources(rows, (k) => coordsAll[k], diurnal); sourceMemo.set(diurnal, s); }
  return s;
};

function tileBounds(x: number, y: number, z: number) {
  const nn = 2 ** z;
  const lon = (t: number) => (t / nn) * 360 - 180;
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / nn))) * 180) / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

type HourVal = { pm25: number; pm25_delta: number; no2_delta: number; pi_half: number };
const perHour = new Map<number, HourVal[]>(); // hour -> value per facility index
for (const h of neededHours) {
  const fh = fhOf(h);
  const grids: FieldInputs['grids'] = [];
  for (const [c, [x, y]] of pack.meta.cells.entries()) {
    const b = tileBounds(x, y, pack.meta.cell_zoom);
    const g = await fetchBaselineGrid(b.south, b.west, b.north, b.east, fh, noCache);
    grids.push({ cell: c, corners: g.corners, bounds: g.bounds });
  }
  const inputs: FieldInputs = { region, hourLocal: h, monthLocal: month, diurnal: HOURLY_TRAFFIC[h] ?? 1.0, camsDaily, grids };
  const interp = makeInterp(pack, inputs);
  const receptors = fac.map((f, k) => ({ key: k, lat: Number(f.lat), lon: Number(f.lon) }));
  // the map's met rule (scripts/field/engine.ts computeField): model wind at the point, Pasquill class from wind and hour
  const met = (lat: number, lon: number) => {
    const ws = interp(lat, lon).wind_speed;
    const u = Number.isFinite(ws) ? ws : 2.0;
    return { wind: u, stability: pasquillClass(u, h, 0.5) };
  };
  const iso = exhaustAt(sources(inputs.diurnal), receptors, met);
  perHour.set(h, receptors.map((r) => {
    // A zero-emission stand-in "road" at the facility: its own line source is not used when multiDelta is given.
    const stand: RoadRow = { ...rows[0], osm_way_id: -1, traffic_base_estimate: 0, geojson: '' };
    const coords = [[r.lon, r.lat], [r.lon + 1e-6, r.lat]];
    const v = computeRoadAQIv2(stand, coords, r.lat, r.lon, interp(r.lat, r.lon), inputs.diurnal, region, h, month, camsDaily, iso[r.key]);
    return { pm25: v.pm25, pm25_delta: v.pm25_delta, no2_delta: v.no2_delta, pi_half: Math.max(0, v.pi95_hi - v.pm25) };
  }));
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const items = fac.map((f, k) => {
  const hours = ACTIVITY_HOURS[f.jenis] ?? ACTIVITY_HOURS.school;
  const vals = hours.map((h) => perHour.get(h)![k]);
  const mean = (sel: (v: HourVal) => number) => vals.reduce((a, v) => a + sel(v), 0) / vals.length;
  const peak = vals.reduce((best, v, j) => (v.pm25 > best.v ? { v: v.pm25, h: hours[j] } : best), { v: -1, h: hours[0] });
  return {
    id: `${f.t}/${f.id}`, nama: f.nama, kelas: f.kelas, jenis: f.jenis, lat: Number(f.lat), lon: Number(f.lon),
    jalan_terdekat: f.jalan, d_ramai_m: Math.round(Number(f.d_ramai)), d_major_m: Math.round(Number(f.d_major)),
    jam: hours, pm25: round(mean((v) => v.pm25)), pm25_latar: round(mean((v) => v.pm25 - v.pm25_delta)),
    pm25_lalin: round(mean((v) => v.pm25_delta), 2), no2_lalin: round(mean((v) => v.no2_delta), 1),
    pm25_puncak: round(peak.v), jam_puncak: peak.h, pi95: round(mean((v) => v.pi_half)),
  };
});
// Ranked by vehicle exhaust (traffic NOx) during activity hours: it is resolved facility by facility and is what road and
// school measures can change. Totals are shown, but their 95% interval (about +-23 ug/m3) is wider than the spread of
// totals between facilities, so totals cannot order them.
items.sort((a, b) => b.no2_lalin - a.no2_lalin || b.pm25_lalin - a.pm25_lalin);
const asap = items.map((it) => it.no2_lalin).sort((a, b) => a - b);
const q = (p: number) => asap[Math.min(asap.length - 1, Math.floor(p * asap.length))];
const rankIn: Record<string, number> = {};
const ranked = items.map((it, j) => ({ peringkat: j + 1, peringkat_kelas: (rankIn[it.kelas] = (rankIn[it.kelas] ?? 0) + 1), ...it }));

const out = {
  wilayah: name, tanggal: dateLocal, zona: `UTC+${tz}`, dibuat: new Date().toISOString(),
  jumlah: ranked.length, jam_kegiatan: ACTIVITY_HOURS, urutan: 'asap_kendaraan',
  ringkasan: {
    asap_median: round(q(0.5), 1),
    asap_p90: round(q(0.9), 1),
    lalin_di_atas_1: ranked.filter((r) => r.pm25_lalin > 1).length,
    lalin_di_atas_0_5: ranked.filter((r) => r.pm25_lalin > 0.5).length,
    pm25_median: [...ranked].sort((a, b) => a.pm25 - b.pm25)[Math.floor(ranked.length / 2)].pm25,
  },
  mesin: 'VAYU v2.2: latar CAMS (Open-Meteo, prakiraan per jam) + asap kendaraan iso1 (semua jalan besar dalam 500 m dan 40 jalan kecil terdekat, angin segala arah, minimal 1 m/s, jalan dua jalur dibagi dua)',
  cams_harian: round(camsDaily, 2), ruas: pack.n, geometri: pack.meta.geometry,
  detik: (Date.now() - t0) / 1000,
  fasilitas: ranked,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out));
console.log(JSON.stringify({ ...out, fasilitas: ranked.slice(0, 5) }));
