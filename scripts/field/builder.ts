/**
 * Field builder core (LAMPIRAN_TEKNIS L2): one region, one hour, no storage. build-field.mts writes its result to a
 * local folder; infra/lambda/field-builder.ts writes it to S3. Both write the run's files first and the manifest last,
 * so a manifest never points at a cell that does not exist yet. run = valid hour in UTC, YYYYMMDDHH.
 */
import { fetchBaselineGrid } from '../../api/vayu/_baseline.js';
import { HOURLY_TRAFFIC, fetchCamsDailyMean } from '../../api/vayu/road-aqi.js';
import type { RoadPack } from './pack.js';
import { encodeCell, saturated } from './cells.js';
import { computeField, type FieldInputs } from './engine.js';
import { measureHour, type RegionMeasureParams } from './measure.js';
import { hourlyValidation } from './hourly-validation.js';

export interface BuildOptions {
  name: string;
  /** Engine region key (bali, jakarta). */
  region: string;
  /** Hours east of UTC (8 WITA, 7 WIB). */
  tz: number;
  /** No measuring station inside the area: values are shown as indicative only. */
  indicative: boolean;
  measure: 'auto' | 'off';
  measureParams?: RegionMeasureParams;
  openaqKey?: string;
  /** Spacing between OpenAQ requests (rate limit 60 per minute). */
  spacingMs?: number;
  now?: Date;
}

export interface BuiltRun {
  run: string;
  cells: Array<{ c: number; bytes: Uint8Array }>;
  inputs: FieldInputs;
  report: Record<string, unknown>;
  manifest: Record<string, unknown>;
}

export function tileBounds(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = (t: number) => (t / n) * 360 - 180;
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

/** Valid hour (UTC, start of the current hour) and its run id. */
export function runFor(now: Date): { validUtc: Date; run: string } {
  const validUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  return { validUtc, run: validUtc.toISOString().slice(0, 13).replace(/[-T]/g, '') };
}

export async function buildFieldRun(pack: RoadPack, o: BuildOptions): Promise<BuiltRun> {
  const t0 = Date.now();
  const { validUtc, run } = runFor(o.now ?? new Date());
  const local = new Date(validUtc.getTime() + o.tz * 3600_000);
  const hourLocal = local.getUTCHours();
  const monthLocal = local.getUTCMonth() + 1;
  const todayLocal = local.toISOString().slice(0, 10);

  const noCache = { redisGet: async () => null, redisSetEx: async () => {}, ttlSec: 0 };
  const grids: FieldInputs['grids'] = [];
  const gridCache = new Map<string, Awaited<ReturnType<typeof fetchBaselineGrid>>>();
  for (const [c, [x, y]] of pack.meta.cells.entries()) {
    const b = tileBounds(x, y, pack.meta.cell_zoom);
    const key = `${Math.round(((b.south + b.north) / 2) * 10)}:${Math.round(((b.west + b.east) / 2) * 10)}`;
    let g = gridCache.get(key);
    if (!g) {
      g = await fetchBaselineGrid(b.south, b.west, b.north, b.east, 0, noCache);
      gridCache.set(key, g);
    }
    grids.push({ cell: c, corners: g.corners, bounds: g.bounds });
  }
  const [w, s, e, n] = pack.meta.bbox;
  const camsDaily = await fetchCamsDailyMean((s + n) / 2, (w + e) / 2, o.region, todayLocal);
  // The last complete hour: OpenAQ hourly values and METAR reports of the current hour are not in yet.
  const measured = o.measure === 'off' ? undefined
    : await measureHour(o.measureParams, new Date(validUtc.getTime() - 3600_000), { openaqKey: o.openaqKey }, { spacingMs: o.spacingMs ?? 1100 });
  const inputs: FieldInputs = { region: o.region, hourLocal, monthLocal, diurnal: HOURLY_TRAFFIC[hourLocal] ?? 1.0, camsDaily, grids, measured };
  const t1 = Date.now();

  const results = computeField(pack, inputs);
  const t2 = Date.now();

  const cellsCol = pack.col<Uint16Array>('c');
  const cells: BuiltRun['cells'] = [];
  let bytes = 0;
  const sat = { pm25_delta: 0, no2: 0, no2_delta: 0, pi_half: 0 };
  const byCell = new Map<number, typeof results>();
  for (const r of results) {
    const c = cellsCol[r.k];
    const list = byCell.get(c);
    if (list) list.push(r); else byCell.set(c, [r]);
  }
  for (let c = 0; c < pack.meta.cells.length; c++) {
    const vals = byCell.get(c);
    if (!vals?.length) continue;
    for (const r of vals) for (const col of Object.keys(sat) as Array<keyof typeof sat>) if (saturated(col, r[col])) sat[col]++;
    const buf = encodeCell(vals);
    cells.push({ c, bytes: buf });
    bytes += buf.byteLength;
  }
  const pm = results.map((r) => r.pm25).sort((a, b) => a - b);
  const report = {
    run, region: o.region, name: o.name, roads: results.length, cells: cells.length, bytes, saturated: sat,
    pm25: { min: pm[0], median: pm[Math.floor(pm.length / 2)], p95: pm[Math.floor(pm.length * 0.95)], max: pm[pm.length - 1] },
    inputs: { hourLocal, monthLocal, diurnal: inputs.diurnal, camsDaily, background_grids: gridCache.size },
    measurement: measured ? { method: measured.method, hour_utc: measured.hour_utc, sensors: measured.sensors.length,
      vetted: measured.sensors_vetted, koschmieder: measured.koschmieder ?? null, note: measured.note } : { method: 'off' },
    // running hidden-sensor test of the measurement layer for this hour (F5-07); null when nothing was kriged
    validation: hourlyValidation(measured),
    seconds: { inputs: (t1 - t0) / 1000, compute: (t2 - t1) / 1000, total: (Date.now() - t0) / 1000 },
  };
  const median = (a: number[]) => { const q = [...a].sort((x, y) => x - y); return q.length ? q[Math.floor(q.length / 2)] : Number.NaN; };
  const cellStats: Record<string, { pm25_median: number; no2_median: number; roads: number }> = {};
  for (const { c } of cells) {
    const vals = byCell.get(c)!;
    cellStats[String(c)] = { pm25_median: median(vals.map((v) => v.pm25)), no2_median: median(vals.map((v) => v.no2)), roads: vals.length };
  }
  const manifest = {
    geometry: pack.meta.geometry, run, computed_at: new Date().toISOString(), valid_hour_local: hourLocal,
    engine: 'v2.1', cells: cells.map((x) => x.c), forecast_runs: [], sensors_used: measured?.method === 'kriging' ? measured.sensors.length : 0,
    measurement: { method: measured?.method ?? 'off', hour_utc: measured?.hour_utc ?? null, sensor_hour_utc: measured?.sensor_hour_utc ?? null,
      metar: measured?.metar?.station ?? null },
    cell_tiles: pack.meta.cells, cell_stats: cellStats, indicative: o.indicative,
    state: { background: [], met: [], diurnal: inputs.diurnal, oi_weights: [] },
    inputs_note: measured?.method === 'kriging'
      ? `ambient from log-space kriging of ${measured.sensors.length} OpenAQ citizen sensors (hour ${measured.sensor_hour_utc}) + CALINE4 road increment`
      : measured?.method === 'koschmieder'
        ? `ambient raised to the ${measured.metar?.station} visibility smoke estimate (${measured.koschmieder?.reason}) + CALINE4 road increment`
        : 'Open-Meteo background per z12 cell + CAMS daily mean + CALINE4 road increment; no measurement this hour',
  };
  return { run, cells, inputs, report, manifest };
}

export const CACHE = {
  immutable: 'public, max-age=31536000, immutable',
  manifest: 'public, max-age=60, stale-while-revalidate=600',
} as const;

/** Objects of a run in write order (cells, inputs, report, then the manifest), keys as in LAMPIRAN_TEKNIS L1. */
/** Object tag of an hourly run's files; the bucket's lifecycle rule expires them after 7 days (the manifest has none). */
export const RUN_TAG = 'kind=run';

export interface RunObject { key: string; body: Uint8Array | string; cacheControl: string; contentType: string; tagging?: string }

/** Value cells of a run (v/<name>/<run>/<c>.bin): stored gzip-encoded on S3, about 60 % smaller (F1-13). */
export const isCellKey = (key: string) => /^v\/[^/]+\/\d{10}\/\d+\.bin$/.test(key);

/**
 * Body and Content-Encoding for S3: cells gzip-compressed (browsers decode Content-Encoding: gzip by themselves),
 * everything else as it is. The local CLI writes plain files, so a dev server keeps working without headers.
 */
export function uploadBody(o: RunObject, gzip: (b: Uint8Array) => Uint8Array): { body: Uint8Array | string; contentEncoding?: 'gzip' } {
  if (!isCellKey(o.key) || typeof o.body === 'string') return { body: o.body };
  return { body: gzip(o.body), contentEncoding: 'gzip' };
}

/** Key of a run's report; its presence marks the run as built (the builder never rewrites a run). */
export const reportKey = (name: string, run: string) => `audit/${name}/${run}/report.json`;

/**
 * Objects of one run in write order: cells, inputs, report, then the manifest last so it never names an incomplete run.
 * Inputs and report (sensor readings, timings) go under audit/, which CloudFront does not serve.
 */
export function runObjects(name: string, b: BuiltRun): RunObject[] {
  const run = (key: string, body: Uint8Array | string, contentType: string): RunObject =>
    ({ key, body, cacheControl: CACHE.immutable, contentType, tagging: RUN_TAG });
  return [
    ...b.cells.map(({ c, bytes }) => run(`v/${name}/${b.run}/${c}.bin`, bytes, 'application/octet-stream')),
    run(`audit/${name}/${b.run}/inputs.json`, JSON.stringify(b.inputs), 'application/json'),
    run(reportKey(name, b.run), JSON.stringify(b.report, null, 1), 'application/json'),
    { key: `v/${name}/manifest.json`, body: JSON.stringify(b.manifest, null, 1), cacheControl: CACHE.manifest, contentType: 'application/json' },
  ];
}
