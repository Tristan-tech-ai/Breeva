/**
 * Task F3-04 on the Badung-Denpasar graph: 200 seeded motor trips (1.5-6 km straight line), routed with the two-number
 * cost and with the emergency option. Checks: no route uses a local street (residential, living_street, service)
 * outside the access zone of its start and destination, nor a footway, path or steps; every route reports its own
 * exposure and the exposure it imposes. Reports how much the two-number cost lowers the imposed exposure.
 *
 *   pnpm exec tsx scripts/field/motor-bench.mts [--name badung_denpasar] [--field D:/breeva-ml-data/field]
 * Exit 1 on any violation. Writes <field>/graphs/<geometry>/motor_bench_<name>.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WalkGraph } from '../../src/lib/route/walkGraph.js';
import { route } from '../../src/lib/route/router.js';
import { accessZone, isLocal, motorAllowedClass, motorNode, motorRoute } from '../../src/lib/route/cost.js';
import { HargaIndex } from '../../src/lib/field/harga.js';
import { decodeCell } from './cells.js';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'badung_denpasar');
const root = arg('field', 'D:/breeva-ml-data/field');
const man = JSON.parse(readFileSync(join(root, 'v', name, 'manifest.json'), 'utf8')) as { run: string; cells: number[]; geometry: string };
const g = new WalkGraph(new Uint8Array(readFileSync(join(root, 'graphs', man.geometry, `${name}.bin`))));
const harga = new HargaIndex(new Uint8Array(readFileSync(join(root, 'harga', man.geometry, 'client', `${name}.bin`))));
const cells = new Map<number, ReturnType<typeof decodeCell>>();
for (const c of man.cells) cells.set(c, decodeCell(new Uint8Array(readFileSync(join(root, 'v', name, man.run, `${c}.bin`)))));
const no2 = new Float64Array(g.m).fill(Number.NaN), hh = new Float64Array(g.m).fill(Number.NaN);
for (let e = 0; e < g.m; e++) {
  const r = g.road(e);
  if (!r) continue;
  const v = cells.get(r.c)?.[r.i];
  if (v) no2[e] = v.no2;
  const h = harga.value(r.c, r.i);
  if (h != null) hh[e] = h;
}

let a = 20261117 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const q = (x: number[], p: number) => { const s = [...x].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

let violations = 0, noRoute = 0, missingNumbers = 0, wider = 0;
const reduction: number[] = [], extraTime: number[] = [], ms: number[] = [];
let trips = 0;
while (trips < 200) {
  const s = Math.floor(rnd() * g.n), t = Math.floor(rnd() * g.n);
  const d = Math.hypot((g.nodeLon(t) - g.nodeLon(s)) * 110000, (g.nodeLat(t) - g.nodeLat(s)) * 110574);
  if (d < 1500 || d > 6000 || !motorNode(g, s) || !motorNode(g, t)) continue;
  trips++;
  const t0 = performance.now();
  const twoR = motorRoute(route, g, 'motor', s, t, { no2, harga: hh });
  ms.push(performance.now() - t0);
  const emerR = motorRoute(route, g, 'motor', s, t, { no2, harga: hh }, true);
  if (!twoR || !emerR) { noRoute++; continue; }
  const two = twoR.route, emer = emerR.route;
  if (twoR.accessM > 500) wider++;
  for (const [r, acc] of [[two, twoR.accessM], [emer, emerR.accessM]] as const) {
    const zone = accessZone(g, s, t, acc);
    for (const e of r.edges) if (!motorAllowedClass(g, e) || (isLocal(g, e) && !zone[e])) violations++;
    if (!(Number.isFinite(r.exposure) && Number.isFinite(r.imposed) && r.imposed > 0)) missingNumbers++;
  }
  reduction.push(1 - two.imposed / emer.imposed);
  extraTime.push(two.timeS / emer.timeS - 1);
}
const report = {
  name, run: man.run, trips, no_route: noRoute, access_zone_widened_to_1500m: wider, violations, missing_numbers: missingNumbers,
  imposed_reduction_vs_emergency: { median: Number(q(reduction, 0.5).toFixed(3)), p90: Number(q(reduction, 0.9).toFixed(3)) },
  extra_time_vs_emergency: { median: Number(q(extraTime, 0.5).toFixed(3)), p90: Number(q(extraTime, 0.9).toFixed(3)) },
  ms_median: Number(q(ms, 0.5).toFixed(1)), at: new Date().toISOString(),
};
writeFileSync(join(root, 'graphs', man.geometry, `motor_bench_${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
if (violations || missingNumbers || noRoute > trips * 0.05) process.exit(1);
