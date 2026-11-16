/**
 * Gate G2 (LAMPIRAN_TEKNIS L2): for N random roads, the value cells of a run must match the service engine recomputed
 * on the same inputs (the run's inputs.json) to within half a quantisation step, for every column. Saturated values
 * (above the top of a column's range) are counted separately: there the cell stores the cap, by design.
 *
 *   pnpm exec tsx scripts/field/parity.mts --pack <pack.bin> --run-dir D:/breeva-ml-data/field/v/badung_denpasar/<run> [--inputs <inputs.json>] [--n 1000]
 * Exit 0 when every non-saturated comparison is within tolerance. Writes <field>/reports/parity_<name>_<run>.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RoadPack } from './pack.js';
import { decodeCell, saturated, STEP } from './cells.js';
import { computeField, type FieldInputs } from './engine.js';

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

/** Deterministic sample (mulberry32) so a rerun checks the same roads. */
function sample(n: number, k: number, seed = 20261116): number[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const chosen = new Set<number>();
  while (chosen.size < Math.min(k, n)) chosen.add(Math.floor(rnd() * n));
  return [...chosen].sort((x, y) => x - y);
}

const pack = new RoadPack(new Uint8Array(readFileSync(arg('pack'))));
const runDir = arg('run-dir');
const n = Number(arg('n', '1000'));
// inputs.json sits beside the cells in runs built before 16 Nov 18.00 WIB, under audit/<name>/<run>/ since then
const auditInputs = join(dirname(dirname(dirname(runDir))), 'audit', basename(dirname(runDir)), basename(runDir), 'inputs.json');
const inputsFile = arg('inputs', existsSync(join(runDir, 'inputs.json')) ? join(runDir, 'inputs.json') : auditInputs);
const inputs = JSON.parse(readFileSync(inputsFile, 'utf8')) as FieldInputs;

const cOf = pack.col<Uint16Array>('c');
const iOf = pack.col<Uint32Array>('i');
const cells = new Map<number, ReturnType<typeof decodeCell>>();
const ks = sample(pack.n, n);
const fresh = computeField(pack, inputs, ks);

const cols = ['pm25', 'pm25_delta', 'no2', 'no2_delta', 'pi_half'] as const;
const maxErr: Record<string, number> = {}, over: Record<string, number> = {}, sat: Record<string, number> = {};
for (const c of cols) { maxErr[c] = 0; over[c] = 0; sat[c] = 0; }
let flagMismatch = 0;
for (const r of fresh) {
  const c = cOf[r.k];
  if (!cells.has(c)) cells.set(c, decodeCell(new Uint8Array(readFileSync(join(runDir, `${c}.bin`)))));
  const got = cells.get(c)![iOf[r.k]];
  for (const col of cols) {
    if (col !== 'pm25' && saturated(col, r[col])) { sat[col]++; continue; }
    const e = Math.abs(got[col] - r[col]);
    maxErr[col] = Math.max(maxErr[col], e);
    if (e > STEP[col] / 2 + 1e-9) over[col]++;
  }
  if (got.confidence !== r.confidence || got.ood !== r.ood) flagMismatch++;
}
const ok = Object.values(over).every((x) => x === 0) && flagMismatch === 0;
const report = {
  run: basename(runDir), roads_checked: fresh.length, tolerance: Object.fromEntries(cols.map((c) => [c, STEP[c] / 2])),
  max_abs_error: maxErr, over_tolerance: over, saturated_skipped: sat, flag_mismatches: flagMismatch, pass: ok,
  checked_at: new Date().toISOString(),
};
const repDir = join(dirname(dirname(dirname(runDir))), 'reports');
mkdirSync(repDir, { recursive: true });
writeFileSync(join(repDir, `parity_${basename(dirname(runDir))}_${basename(runDir)}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
process.exitCode = ok ? 0 : 1;
