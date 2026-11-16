/**
 * Task F3-04 on the Badung-Denpasar graph: 200 seeded motor trips (1.5-6 km straight line), routed with the two-number
 * cost and with the emergency option. Checks: no route uses a local street (residential, living_street, service)
 * outside the access zone of its start and destination, nor a footway, path or steps; every route reports its own
 * exposure and the exposure it imposes. Reports how much the two-number cost lowers the imposed exposure.
 * School zone (F3-07): every trip is routed at 07.00 local time (entry hours); no route may use a collector or local
 * edge past a school that is not the trip's own. The same trip at 10.00 shows how many routes the zone changes, and
 * the strict variant (arterials closed too) is routed once to record why arterials stay open.
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
import { ARTERIAL, motorRouteAt, ownSchools, schoolEdges, schoolFilter, type SchoolFile } from '../../src/lib/route/schoolZone.js';
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

const sf = JSON.parse(readFileSync(join(root, 'graphs', man.geometry, `${name}_schools.json`), 'utf8')) as SchoolFile;
const tz0 = performance.now();
const edgeSchool = schoolEdges(g, sf.points, sf.radius_m);
const schoolEdgesMs = performance.now() - tz0;
const schoolEdgeCount = edgeSchool.reduce((n, k) => n + (k >= 0 ? 1 : 0), 0);
// 07.00 and 10.00 local time on 17 Nov 2026
const at = (h: number) => Date.UTC(2026, 10, 17, h - sf.tz, 0);

let a = 20261117 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const q = (x: number[], p: number) => { const s = [...x].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

let violations = 0, noRoute = 0, missingNumbers = 0, wider = 0, schoolViolations = 0, schoolChanged = 0, schoolOwn = 0, strictNoRoute = 0, strictChanged = 0, freeNoRoute = 0, lifted = 0;
const schoolExtra: number[] = [];
const reduction: number[] = [], extraTime: number[] = [], ms: number[] = [];
let trips = 0;
while (trips < 200) {
  const s = Math.floor(rnd() * g.n), t = Math.floor(rnd() * g.n);
  const d = Math.hypot((g.nodeLon(t) - g.nodeLon(s)) * 110000, (g.nodeLat(t) - g.nodeLat(s)) * 110574);
  if (d < 1500 || d > 6000 || !motorNode(g, s) || !motorNode(g, t)) continue;
  trips++;
  if (schoolFilter(g, sf, edgeSchool, s, t, at(10)) !== null) throw new Error('school zone active at 10.00');
  const sz = { file: sf, edgeSchool };
  const t0 = performance.now();
  const twoR = motorRouteAt(route, g, 'motor', s, t, { no2, harga: hh }, sz, at(7));
  ms.push(performance.now() - t0);
  const emerR = motorRouteAt(route, g, 'motor', s, t, { no2, harga: hh }, sz, at(7), true);
  const freeR = motorRoute(route, g, 'motor', s, t, { no2, harga: hh });
  const strictR = motorRoute(route, g, 'motor', s, t, { no2, harga: hh, allow: schoolFilter(g, sf, edgeSchool, s, t, at(7), true)! });
  if (!freeR) freeNoRoute++;
  if (!strictR) strictNoRoute++;
  else if (freeR && strictR.route.edges.join(',') !== freeR.route.edges.join(',')) strictChanged++;
  if (!twoR || !emerR) { noRoute++; continue; }
  const two = twoR.route, emer = emerR.route;
  if (twoR.accessM > 500) wider++;
  if (twoR.school === 'lifted-near-ends' || emerR.school === 'lifted-near-ends') lifted++;
  const ends = accessZone(g, s, t, 1500);
  const own = ownSchools(g, sf.points, edgeSchool, s, t);
  if (own.size) schoolOwn++;
  if (freeR && freeR.route.edges.join(',') !== two.edges.join(',')) { schoolChanged++; schoolExtra.push(two.timeS / freeR.route.timeS - 1); }
  for (const [r, acc, st] of [[two, twoR.accessM, twoR.school], [emer, emerR.accessM, emerR.school]] as const) {
    const zone = accessZone(g, s, t, acc);
    for (const e of r.edges) if (!motorAllowedClass(g, e) || (isLocal(g, e) && !zone[e])) violations++;
    // a kept zone: no minor street past another school; a lifted one: none outside the access zone of the trip's ends
    for (const e of r.edges) {
      if (edgeSchool[e] < 0 || own.has(edgeSchool[e]) || ARTERIAL.has(g.highway(e))) continue;
      if (st === 'kept' || !ends[e]) schoolViolations++;
    }
    if (!(Number.isFinite(r.exposure) && Number.isFinite(r.imposed) && r.imposed > 0)) missingNumbers++;
  }
  reduction.push(1 - two.imposed / emer.imposed);
  extraTime.push(two.timeS / emer.timeS - 1);
}
const report = {
  name, run: man.run, trips, no_route: noRoute, access_zone_widened_to_1500m: wider, violations, missing_numbers: missingNumbers,
  imposed_reduction_vs_emergency: { median: Number(q(reduction, 0.5).toFixed(3)), p90: Number(q(reduction, 0.9).toFixed(3)) },
  extra_time_vs_emergency: { median: Number(q(extraTime, 0.5).toFixed(3)), p90: Number(q(extraTime, 0.9).toFixed(3)) },
  ms_median: Number(q(ms, 0.5).toFixed(1)),
  school_zone: {
    schools: sf.points.length, radius_m: sf.radius_m, edges_near_school: schoolEdgeCount, edges_ms: Math.round(schoolEdgesMs),
    violations_at_0700: schoolViolations, trips_with_own_school: schoolOwn, lifted_near_ends: lifted, routes_changed_vs_1000: schoolChanged,
    extra_time_when_changed: schoolExtra.length ? { median: Number(q(schoolExtra, 0.5).toFixed(3)), p90: Number(q(schoolExtra, 0.9).toFixed(3)) } : null,
    no_route_at_1000: freeNoRoute,
    strict_through_roads_closed: { no_route: strictNoRoute, routes_changed_vs_1000: strictChanged },
  },
  at: new Date().toISOString(),
};
writeFileSync(join(root, 'graphs', man.geometry, `motor_bench_${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
if (violations || schoolViolations || missingNumbers || noRoute > trips * 0.05) process.exit(1);
