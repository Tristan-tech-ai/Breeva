/**
 * Task F5-11: compare a walking test with the field per road (method in scripts/field/transect.ts, protocol in
 * docs/PROTOKOL_JALAN_TEST.md).
 *
 *   pnpm exec tsx scripts/field/validate-transect.mts --csv jalan_test.csv [--gpx track.gpx] [--name badung_denpasar]
 *        [--pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin] [--base https://d26tdym6xlfc4n.cloudfront.net]
 *        [--max-pair-m 300] [--out hasil.json]
 *
 * Model values come from the published hourly run of each stop's hour (CloudFront keeps runs for 7 days). Sensor
 * values are raw (no humidity correction: the US correction made the match with Bali stations worse, DECISIONS F5-01).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RoadPack } from './pack.js';
import { BUILD_REGIONS } from './regions.js';
import { decodeCell, type CellValue } from '../../src/lib/field/cells.js';
import {
  attachPositions, findStops, makeRoadIndex, meanCi, pairStops, parseGpx, parseSensorCsv, privacyTrim, roadClass,
  type ModelAt, type StopOnRoad,
} from './transect.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'badung_denpasar')!;
const region = BUILD_REGIONS.find((r) => r.name === name);
if (!region) throw new Error(`unknown region ${name}`);
const csvPath = arg('csv');
if (!csvPath) throw new Error('--csv is required');
const base = arg('base', 'https://d26tdym6xlfc4n.cloudfront.net')!.replace(/\/$/, '');
const pack = new RoadPack(new Uint8Array(readFileSync(arg('pack', `D:/breeva-ml-data/field/packs/${region.geometry}/${name}.bin`)!)));
const nearest = makeRoadIndex(pack);

let samples = parseSensorCsv(readFileSync(csvPath, 'utf8'), region.tz);
const gpx = arg('gpx');
if (gpx) samples = attachPositions(samples, parseGpx(readFileSync(gpx, 'utf8')));
const kept = privacyTrim(samples);
const stops = findStops(kept);

const onRoad: StopOnRoad[] = [];
for (const s of stops) {
  const hit = nearest(s.lat, s.lon);
  if (!hit) continue;
  const highway = pack.highway(hit.k);
  onRoad.push({ ...s, road: { ...pack.id(hit.k), highway, klass: roadClass(highway), distM: Math.round(hit.distM) } });
}

// model of each stop: the cell of its road in the run of its hour (UTC hour of the stop's middle)
const runOf = (t: number) => new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, '');
const cells = new Map<string, CellValue[] | null>();
for (const s of onRoad) {
  const key = `${runOf((s.start + s.end) / 2)}/${s.road.c}`;
  if (cells.has(key)) continue;
  const r = await fetch(`${base}/v/${name}/${key}.bin`);
  cells.set(key, r.ok ? decodeCell(new Uint8Array(await r.arrayBuffer())) : null);
}
const model = (s: StopOnRoad): ModelAt | null => {
  const v = cells.get(`${runOf((s.start + s.end) / 2)}/${s.road.c}`)?.[s.road.i];
  return v ? { pm25: v.pm25, pm25_delta: v.pm25_delta, no2: v.no2, no2_delta: v.no2_delta } : null;
};

const pairs = pairStops(onRoad, model, Number(arg('max-pair-m', '300')));
const byClass = (k: string) => onRoad.filter((s) => s.road.klass === k);
const report = {
  region: name, csv: csvPath.split(/[\\/]/).pop(), samples: samples.length, samples_after_privacy_trim: kept.length,
  stops: onRoad.map((s) => ({
    start: new Date(s.start).toISOString(), minutes: Math.round((s.end - s.start) / 6000) / 10, road: s.road,
    measured_pm25: Math.round(s.pm25 * 10) / 10, model: model(s), run: runOf((s.start + s.end) / 2),
  })),
  per_class: Object.fromEntries(['kecil', 'besar'].map((k) => [k, {
    measured_pm25: meanCi(byClass(k).map((s) => s.pm25)),
    model_pm25: meanCi(byClass(k).map((s) => model(s)?.pm25).filter((x): x is number => x != null)),
  }])),
  pairs: pairs.length,
  pair_difference_big_minus_small: {
    measured_pm25: meanCi(pairs.map((p) => p.measured_diff)),
    model_pm25: meanCi(pairs.map((p) => p.model_diff).filter((x): x is number => x != null)),
    model_no2: meanCi(pairs.map((p) => p.model_no2_diff).filter((x): x is number => x != null)),
  },
  note: 'PM2.5 sensor mentah tanpa koreksi kelembapan; model = medan per ruas pada run jam yang sama; posisi dalam 150 m dari titik awal dan akhir dibuang.',
};
const out = arg('out', csvPath.replace(/\.csv$/i, '') + '.hasil.json')!;
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ out, samples: report.samples, stops: onRoad.length, pairs: pairs.length, pair_difference: report.pair_difference_big_minus_small }));
