import { describe, expect, it } from 'vitest';
import type { WalkGraph } from '../src/lib/route/walkGraph';
import { MIN_GAIN, WALK_BUDGET, withinBudget } from '../src/lib/route/router';
import { exhaustRef, walkExhaust, walkRoutes, WALK_SPEED } from '../src/lib/route/walkExhaust';
import { meanAlong } from '../src/lib/route/departForecast';
import { EXHAUST_FLOOR } from '../src/lib/route/summary';

/** A graph from undirected roads [a, b, metres]; every node at one point, so the A* heuristic is 0 (plain Dijkstra). */
function graph(n: number, roads: Array<[number, number, number]>) {
  const dir: Array<[number, number, number, number]> = []; // from, to, metres, road index
  roads.forEach(([a, b, m], k) => { dir.push([a, b, m, k], [b, a, m, k]); });
  dir.sort((p, q) => p[0] - q[0]);
  const off = new Uint32Array(n + 1), target = new Uint32Array(dir.length), lenDm = new Uint16Array(dir.length), road = new Int32Array(dir.length);
  dir.forEach(([a, b, m, k], e) => { off[a + 1]++; target[e] = b; lenDm[e] = m * 10; road[e] = k; });
  for (let u = 0; u < n; u++) off[u + 1] += off[u];
  const g = { n, m: dir.length, off, target, lenDm, nodeLat: () => -8.6, nodeLon: () => 115.16 } as unknown as WalkGraph;
  /** per-edge array from one value per road */
  const perEdge = (v: number[]) => Float64Array.from(road, (k) => v[k]);
  const roadsOf = (edges: number[]) => [...new Set(edges.map((e) => road[e]))];
  return { g, perEdge, roadsOf };
}

// Tristan's case in Buduk (27 Nov): a street straight to the destination, lanes beside it 16 % longer with half the
// exhaust, and a far path 60 % longer with a little less again. 0 = start, 1 = destination.
const STREET = 0, LANE = [1, 2], FAR = [3, 4];
const buduk = graph(4, [[0, 1, 1000], [0, 2, 580], [2, 1, 580], [0, 3, 800], [3, 1, 800]]);
const X = [2.5, 1.5, 1.5, 1, 1];

describe('walking routes by exhaust within a time budget (T7)', () => {
  it('the route called cleanest takes the lanes, not the street, and not the far path beyond the budget', () => {
    const rs = walkRoutes(buduk.g, 0, 1, buduk.perEdge(X), undefined, 0);
    expect(rs).toHaveLength(2);
    expect(buduk.roadsOf(rs[0].edges)).toEqual([STREET]);
    expect(buduk.roadsOf(rs[1].edges).sort()).toEqual(LANE);
    expect(rs[1].timeS).toBeLessThanOrEqual(rs[0].timeS * (1 + WALK_BUDGET));
    expect(rs[1].exposure).toBeLessThan(rs[0].exposure * (1 - MIN_GAIN));
  });

  it('a budget too small for the lanes leaves only the fastest route; a wide one reaches the far path with the lanes between', () => {
    const x = buduk.perEdge(X);
    expect(walkRoutes(buduk.g, 0, 1, x, 0.10, 0).map((r) => buduk.roadsOf(r.edges))).toEqual([[STREET]]);
    const wide = walkRoutes(buduk.g, 0, 1, x, 0.70, 0);
    expect(wide.map((r) => buduk.roadsOf(r.edges).sort())).toEqual([[STREET], LANE, FAR]);
    for (let k = 1; k < wide.length; k++) { expect(wide[k].timeS).toBeGreaterThan(wide[k - 1].timeS); expect(wide[k].exposure).toBeLessThan(wide[k - 1].exposure); }
  });

  it('total NO2 in whole ug/m3 (the old exposure) could not tell the street from the lanes; the exhaust can', () => {
    // background 8.5 + exhaust, rounded as the cell file stores it: street 11, lanes 10, far 10 (rounded from 9.5)
    const no2 = buduk.perEdge(X.map((v) => Math.round(8.5 + v)));
    const old = withinBudget(buduk.g, 0, 1, { speed: WALK_SPEED, exposureOf: (e) => no2[e] / 10, wMax: 8, budget: Infinity, minGain: 0 });
    expect(buduk.roadsOf(old[old.length - 1].edges)).toEqual([STREET]); // 1000 m x (1 + 8 x 1.1) < 1160 m x (1 + 8 x 1.0)
    const now = walkRoutes(buduk.g, 0, 1, buduk.perEdge(X), undefined, 0);
    expect(buduk.roadsOf(now[now.length - 1].edges).sort()).toEqual(LANE);
  });

  it('no alternative when the gain is under 5 %, and never a "cleanest" with more exhaust than the fastest', () => {
    // lanes 16 % longer with 15 % less exhaust: the dose is 1.16 x 0.85 = 0.99 of the street's
    expect(walkRoutes(buduk.g, 0, 1, buduk.perEdge([3, 2.55, 2.55, 2.9, 2.9]), undefined, 0)).toHaveLength(1);
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let k = 0; k < 200; k++) {
      const x = buduk.perEdge([0.25, 0.25, 0.25, 0.25, 0.25].map((q) => q * Math.round(1 + rnd() * 40)));
      const rs = walkRoutes(buduk.g, 0, 1, x, undefined, 0);
      const dose = (edges: number[]) => edges.reduce((a, e) => a + x[e] * buduk.g.lenDm[e], 0);
      for (const r of rs.slice(1)) {
        expect(dose(r.edges)).toBeLessThanOrEqual(dose(rs[0].edges) * (1 - MIN_GAIN) + 1e-9);
        expect(r.timeS).toBeLessThanOrEqual(rs[0].timeS * (1 + WALK_BUDGET) + 1e-9);
      }
    }
  });

  it('an edge without a field road counts as the median road, in the search and in the dose', () => {
    const x = buduk.perEdge([3, NaN, NaN, 2, 2]);
    const ref = exhaustRef(x);
    expect(ref).toBe(2); // finite values, two directions each: 2, 2, 2, 2, 3, 3
    const xOf = walkExhaust(x, ref);
    for (let e = 0; e < x.length; e++) expect(xOf(e)).toBe(Number.isFinite(x[e]) ? x[e] : 2);
    // a later hour's mean along the same edges uses the same rule when asked to
    const edges = [...x.keys()].filter((e) => !Number.isFinite(x[e])).slice(0, 1);
    expect(meanAlong(buduk.g, edges, 100, 130, x, ref)).toBe(2);
    expect(meanAlong(buduk.g, edges, 100, 130, x)).toBe(0);
  });

  it('a fastest route without any exhaust has no alternative (no twin of the same time)', () => {
    // two ways of the same length, both without exhaust: only one comes back
    const twin = graph(3, [[0, 1, 500], [0, 2, 250], [2, 1, 250]]);
    expect(walkRoutes(twin.g, 0, 1, twin.perEdge([0, 0, 0]))).toHaveLength(1);
  });

  it('a quiet night does not make a detour out of almost nothing', () => {
    // street 0.2, lanes 0.1: the reference stays at the floor, both routes are "almost none"; the search may still
    // prefer the lanes, but the reference never drops below the floor
    expect(exhaustRef(buduk.perEdge([0.2, 0.1, 0.1, 0.1, 0.1]))).toBe(EXHAUST_FLOOR);
  });

  it('a short walk may always take 12 minutes more (Dalung, 27 Nov): the far path is offered when it breathes least', () => {
    // street 1000 m (12.8 min), lanes 1160 m, far path 1600 m (20.5 min, +7.7 min): beyond 35 %, within 12 minutes
    const rs = walkRoutes(buduk.g, 0, 1, buduk.perEdge(X));
    expect(buduk.roadsOf(rs[rs.length - 1].edges).sort()).toEqual(FAR);
    expect(rs[rs.length - 1].timeS - rs[0].timeS).toBeLessThanOrEqual(720);
  });
});
