// TRAP constant parity guard. The routing overlay (Python), the ranking (route-score.ts), and the
// displayed dose (exposure.ts) MUST agree on the NO2-dominant TRAP weights, or "cleanest" routes,
// the rank, and the displayed number drift apart (the original "cleanest looks dirtier" bug).
// Run: node scripts/test_trap_parity.mjs   (exit 0 = parity holds, 1 = drift).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const py = read('scripts/build_valhalla_aqi_overlay.py');
const rs = read('api/vayu/route-score.ts');
const ex = read('src/lib/exposure.ts');

const fail = [];
const grab = (src, re, name) => {
  const m = src.match(re);
  if (!m) { fail.push(`MISSING ${name}`); return NaN; }
  return parseFloat(m[1]);
};
const grab3 = (src, re, name) => {
  const m = src.match(re);
  if (!m) { fail.push(`MISSING ${name}`); return [NaN, NaN, NaN]; }
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
};

// Shared NO2/PM2.5/PM10 weights — must be identical in all three.
const wPy = grab3(py, /TRAP_W_NO2,\s*TRAP_W_PM25,\s*TRAP_W_PM10\s*=\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 'py weights');
const wRs = grab3(rs, /TRAP_W_NO2 = ([\d.]+), TRAP_W_PM25 = ([\d.]+), TRAP_W_PM10 = ([\d.]+)/, 'route-score weights');
const wEx = grab3(ex, /TRAP_W_NO2 = ([\d.]+), TRAP_W_PM25 = ([\d.]+), TRAP_W_PM10 = ([\d.]+)/, 'exposure weights');

// NO2 -> PM2.5-equivalent constant (the ranked/displayed concentration scale) — route-score == exposure.
const kRs = grab(rs, /TRAP_K_NO2 = ([\d.]+)/, 'route-score K_NO2');
const kEx = grab(ex, /TRAP_K_NO2 = ([\d.]+)/, 'exposure K_NO2');

const eq3 = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
if (!eq3(wPy, wRs)) fail.push(`weights py ${wPy} != route-score ${wRs}`);
if (!eq3(wRs, wEx)) fail.push(`weights route-score ${wRs} != exposure ${wEx}`);
if (Math.abs(kRs - kEx) > 1e-9) fail.push(`K_NO2 route-score ${kRs} != exposure ${kEx}`);

// Sanity: NO2 must dominate (it is the steep, low-background traffic fingerprint).
if (!(wRs[0] > wRs[1] && wRs[0] > wRs[2])) fail.push(`NO2 weight must dominate, got ${wRs}`);

if (fail.length) {
  console.error('TRAP PARITY FAIL:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('TRAP parity OK');
console.log(`  weights (NO2,PM25,PM10) = ${wRs.join(', ')}  [py/route-score/exposure agree]`);
console.log(`  K_NO2 = ${kRs}  [route-score == exposure]`);
