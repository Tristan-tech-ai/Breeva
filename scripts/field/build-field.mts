/**
 * Field builder (LAMPIRAN_TEKNIS L2), one region, one hour.
 *
 *   pnpm exec tsx scripts/field/build-field.mts --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin \
 *        --name badung_denpasar --region bali --tz 8 --out D:/breeva-ml-data/field
 *
 * Writes v/<name>/<run>/<c>.bin (BVF1), v/<name>/<run>/inputs.json and report.json, then v/<name>/manifest.json last,
 * so a manifest never points at a cell that does not exist yet. run = valid hour in UTC, YYYYMMDDHH; never overwritten.
 * Inputs this version uses: Open-Meteo background per z12 cell, CAMS daily mean (region background), static diurnal
 * traffic curve, CALINE4 multi-source dispersion over the whole region. No station bias yet (measurements: task F2-07).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBaselineGrid } from '../../api/vayu/_baseline.js';
import { HOURLY_TRAFFIC, fetchCamsDailyMean } from '../../api/vayu/road-aqi.js';
import { RoadPack } from './pack.js';
import { encodeCell, saturated } from './cells.js';
import { computeField, type FieldInputs } from './engine.js';

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

function tileBounds(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = (t: number) => (t / n) * 360 - 180;
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

function writeAtomic(path: string, data: string | Uint8Array) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const t0 = Date.now();
const packPath = arg('pack');
const name = arg('name');
const region = arg('region');
const tz = Number(arg('tz'));
const outRoot = arg('out', 'D:/breeva-ml-data/field');

const pack = new RoadPack(new Uint8Array(readFileSync(packPath)));
const now = new Date();
const validUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
const run = validUtc.toISOString().slice(0, 13).replace(/[-T]/g, '');
const local = new Date(validUtc.getTime() + tz * 3600_000);
const hourLocal = local.getUTCHours();
const monthLocal = local.getUTCMonth() + 1;
const todayLocal = local.toISOString().slice(0, 10);

const runDir = join(outRoot, 'v', name, run);
if (existsSync(runDir)) throw new Error(`run ${run} already exists (runs are never overwritten): ${runDir}`);

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
const camsDaily = await fetchCamsDailyMean((s + n) / 2, (w + e) / 2, region, todayLocal);
const inputs: FieldInputs = { region, hourLocal, monthLocal, diurnal: HOURLY_TRAFFIC[hourLocal] ?? 1.0, camsDaily, grids };
const t1 = Date.now();

const results = computeField(pack, inputs);
const t2 = Date.now();

mkdirSync(runDir, { recursive: true });
const cellsCol = pack.col<Uint16Array>('c');
const cellIds: number[] = [];
let bytes = 0;
const sat = { pm25_delta: 0, no2: 0, no2_delta: 0, pi_half: 0 };
for (let c = 0; c < pack.meta.cells.length; c++) {
  const vals = results.filter((r) => cellsCol[r.k] === c);
  if (!vals.length) continue;
  for (const r of vals) for (const col of Object.keys(sat) as Array<keyof typeof sat>) if (saturated(col, r[col])) sat[col]++;
  const buf = encodeCell(vals);
  writeAtomic(join(runDir, `${c}.bin`), buf);
  bytes += buf.byteLength;
  cellIds.push(c);
}
writeAtomic(join(runDir, 'inputs.json'), JSON.stringify(inputs));
const pm = results.map((r) => r.pm25).sort((a, b) => a - b);
const report = {
  run, region, name, roads: results.length, cells: cellIds.length, bytes, saturated: sat,
  pm25: { min: pm[0], median: pm[Math.floor(pm.length / 2)], p95: pm[Math.floor(pm.length * 0.95)], max: pm[pm.length - 1] },
  inputs: { hourLocal, monthLocal, diurnal: inputs.diurnal, camsDaily, background_grids: gridCache.size },
  seconds: { inputs: (t1 - t0) / 1000, compute: (t2 - t1) / 1000, total: (Date.now() - t0) / 1000 },
};
writeAtomic(join(runDir, 'report.json'), JSON.stringify(report, null, 1));

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : Number.NaN; };
const cellStats: Record<string, { pm25_median: number; no2_median: number; roads: number }> = {};
for (const c of cellIds) {
  const vals = results.filter((r) => cellsCol[r.k] === c);
  cellStats[String(c)] = { pm25_median: median(vals.map((v) => v.pm25)), no2_median: median(vals.map((v) => v.no2)), roads: vals.length };
}
const manifest = {
  geometry: pack.meta.geometry, run, computed_at: new Date().toISOString(), valid_hour_local: hourLocal,
  engine: 'v2.1', cells: cellIds, forecast_runs: [], sensors_used: 0,
  cell_tiles: pack.meta.cells, cell_stats: cellStats,
  state: { background: [], met: [], diurnal: inputs.diurnal, oi_weights: [] },
  inputs_note: 'Open-Meteo background per z12 cell + CAMS daily mean; no station measurements yet',
};
writeAtomic(join(outRoot, 'v', name, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(report));
