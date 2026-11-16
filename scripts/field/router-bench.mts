/**
 * Gate G3 for the on-device router (task F3-02):
 *   1. the 200 seeded random pairs of vayu/field/route_reference.py: route length at w = 0 within 1 % of networkx;
 *   2. time per route (median < 150 ms) for those pairs and for walking trips of at most 3 km, the latter with the full
 *      Pareto search over PM2.5 exposure from the current field run.
 *
 *   pnpm exec tsx scripts/field/router-bench.mts [--graph <bin>] [--ref <json>] [--field D:/breeva-ml-data/field] [--name badung_denpasar]
 * Exit 1 when a length is off by more than 1 % or a median time is 150 ms or more. Writes <graph dir>/router_bench.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WalkGraph } from '../../src/lib/route/walkGraph.js';
import { pareto, route } from '../../src/lib/route/router.js';
import { decodeCell } from './cells.js';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const graphPath = arg('graph', 'D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.bin');
const refPath = arg('ref', 'D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.ref200.json');
const fieldRoot = arg('field', 'D:/breeva-ml-data/field');
const name = arg('name', 'badung_denpasar');
const SPEED = 1.3; // m/s walking

const g = new WalkGraph(new Uint8Array(readFileSync(graphPath)));
const ref = JSON.parse(readFileSync(refPath, 'utf8')) as { pairs: Array<{ s: number; t: number; length_m: number }> };

// Exposure of each edge: PM2.5 of the field road it runs along, over the median; 1 where an edge has no road.
const man = JSON.parse(readFileSync(join(fieldRoot, 'v', name, 'manifest.json'), 'utf8')) as { run: string; cells: number[] };
const cells = new Map<number, ReturnType<typeof decodeCell>>();
for (const c of man.cells) cells.set(c, decodeCell(new Uint8Array(readFileSync(join(fieldRoot, 'v', name, man.run, `${c}.bin`)))));
const pm = new Float64Array(g.m).fill(Number.NaN);
const no2 = new Float64Array(g.m).fill(Number.NaN);
for (let e = 0; e < g.m; e++) { const r = g.road(e); if (r) { const v = cells.get(r.c)?.[r.i]; if (v) { pm[e] = v.pm25; no2[e] = v.no2; } } }
const medOf = (x: Float64Array) => { const s = Array.from(x).filter(Number.isFinite).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const med = medOf(pm), medNo2 = medOf(no2);
const exposureOf = (e: number) => (Number.isFinite(pm[e]) ? pm[e] / med : 1);
const exposureNo2 = (e: number) => (Number.isFinite(no2[e]) ? no2[e] / medNo2 : 1);

const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// 1. lengths against networkx
const times: number[] = [];
let worst = 0, within = 0;
for (const p of ref.pairs) {
  const t0 = performance.now();
  const r = route(g, p.s, p.t, 0, { speed: SPEED });
  times.push(performance.now() - t0);
  if (!r) throw new Error(`no route ${p.s} -> ${p.t}`);
  const rel = Math.abs(r.lengthM - p.length_m) / p.length_m;
  worst = Math.max(worst, rel);
  if (rel <= 0.01) within++;
}

// 2. walking trips up to 3 km (seeded), full Pareto search
let a = 20261116 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const walkTimes: number[] = [], walkRoutes: number[] = [], walkSaving: number[] = [];
const no2Routes: number[] = [], no2Saving: number[] = [], no2Extra: number[] = [];
while (walkTimes.length < 200) {
  const s = Math.floor(rnd() * g.n), t = Math.floor(rnd() * g.n);
  const dx = (g.nodeLon(t) - g.nodeLon(s)) * 111320 * Math.cos((g.nodeLat(s) * Math.PI) / 180);
  const dy = (g.nodeLat(t) - g.nodeLat(s)) * 110574;
  const d = Math.hypot(dx, dy);
  if (s === t || d < 500 || d > 3000) continue;
  const t0 = performance.now();
  const rs = pareto(g, s, t, { speed: SPEED, exposureOf });
  walkTimes.push(performance.now() - t0);
  walkRoutes.push(rs.length);
  if (rs.length > 1) walkSaving.push(1 - rs[rs.length - 1].exposure / rs[0].exposure);
  const rn = pareto(g, s, t, { speed: SPEED, exposureOf: exposureNo2 });
  no2Routes.push(rn.length);
  if (rn.length > 1) { no2Saving.push(1 - rn[rn.length - 1].exposure / rn[0].exposure); no2Extra.push(rn[rn.length - 1].timeS / rn[0].timeS - 1); }
}

const report = {
  graph: graphPath, n: g.n, m: g.m, run: man.run, speed_m_s: SPEED,
  networkx_pairs: { n: ref.pairs.length, within_1pct: within, worst_rel_diff: Number(worst.toFixed(6)),
    ms_median: Number(q(times, 0.5).toFixed(1)), ms_p95: Number(q(times, 0.95).toFixed(1)), median_length_m: q(ref.pairs.map((p) => p.length_m), 0.5) },
  walking_le_3km_pareto: { n: walkTimes.length, ms_median: Number(q(walkTimes, 0.5).toFixed(1)), ms_p95: Number(q(walkTimes, 0.95).toFixed(1)),
    routes_median: q(walkRoutes, 0.5), exposure_saving_cleanest_vs_fastest_median: Number(q(walkSaving, 0.5).toFixed(3)), with_alternatives: walkSaving.length },
  walking_le_3km_pareto_no2: { routes_median: q(no2Routes, 0.5), with_alternatives: no2Saving.length,
    no2_saving_cleanest_vs_fastest_median: no2Saving.length ? Number(q(no2Saving, 0.5).toFixed(3)) : null,
    extra_time_cleanest_median: no2Extra.length ? Number(q(no2Extra, 0.5).toFixed(3)) : null },
  node: process.version, cpu: 'desktop PC (not a phone)', at: new Date().toISOString(),
};
writeFileSync(join(dirname(graphPath), 'router_bench.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
if (within !== ref.pairs.length || report.networkx_pairs.ms_median >= 150 || report.walking_le_3km_pareto.ms_median >= 150) process.exit(1);
