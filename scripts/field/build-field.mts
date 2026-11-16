/**
 * Field builder, command line (LAMPIRAN_TEKNIS L2), one region, one hour, written to a local field folder.
 *
 *   pnpm exec tsx --env-file=<path to .env.local> scripts/field/build-field.mts --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin \
 *        --name badung_denpasar --region bali --tz 8 --out D:/breeva-ml-data/field [--indicative] [--measure off]
 *
 * The computation is scripts/field/builder.ts (shared with the hourly Lambda, infra/lambda/field-builder.ts). Writes
 * v/<name>/<run>/<c>.bin (BVF1), audit/<name>/<run>/inputs.json and report.json, then v/<name>/manifest.json last. Runs are never
 * overwritten. Inputs: Open-Meteo background per z12 cell, CAMS daily mean, static diurnal traffic curve, CALINE4
 * multi-source dispersion, and the measurement layer of the last complete hour (scripts/field/measure.ts, parameters in
 * scripts/field/params/measure.json). OPENAQ_API_KEY comes from the environment; it is never printed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadPack } from './pack.js';
import { buildFieldRun, runFor, runObjects } from './builder.js';
import type { RegionMeasureParams } from './measure.js';

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

function writeAtomic(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true }); // audit/ objects live outside the run folder
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const name = arg('name');
const outRoot = arg('out', 'D:/breeva-ml-data/field');
const measure = arg('measure', 'auto');
if (measure !== 'auto' && measure !== 'off') throw new Error('--measure must be auto or off');
const { run } = runFor(new Date());
const runDir = join(outRoot, 'v', name, run);
if (existsSync(runDir)) throw new Error(`run ${run} already exists (runs are never overwritten): ${runDir}`);

const paramsFile = join(dirname(fileURLToPath(import.meta.url)), 'params', 'measure.json');
const measureParams = (JSON.parse(readFileSync(paramsFile, 'utf8')).regions ?? {})[name] as RegionMeasureParams | undefined;
const pack = new RoadPack(new Uint8Array(readFileSync(arg('pack'))));
const built = await buildFieldRun(pack, {
  name, region: arg('region'), tz: Number(arg('tz')), indicative: process.argv.includes('--indicative'),
  measure, measureParams, openaqKey: process.env.OPENAQ_API_KEY,
  exhaust: process.argv.includes('--legacy-exhaust') ? 'legacy' : 'iso1',
});
mkdirSync(runDir, { recursive: true });
for (const o of runObjects(name, built)) writeAtomic(join(outRoot, o.key), o.body);
console.log(JSON.stringify(built.report));
