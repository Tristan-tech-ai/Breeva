import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalkGraph } from '../src/lib/route/walkGraph';
import { optionsFor } from '../src/lib/route/cost';
import { schoolEdges } from '../src/lib/route/schoolZone';
import { median } from '../src/lib/route/fieldMedian';

// 3 x 3 grid of about 110 m (vayu/field/make_graph_fixture.py)
const g = new WalkGraph(new Uint8Array(readFileSync('tests/fixtures/graph_small.bin')));

/** schoolEdges as it was before F3-21 (string grid keys), the reference the faster one must match edge for edge. */
function schoolEdgesBefore(points: Array<[number, number]>, radiusM = 50): Int32Array {
  const M_LAT = 110574;
  const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
  };
  const out = new Int32Array(g.m).fill(-1);
  if (!points.length) return out;
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  const cell = Math.max(radiusM, 1);
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, number[]>();
  const px = points.map((p) => p[1] * mLon), py = points.map((p) => p[0] * M_LAT);
  points.forEach((_, k) => { const kk = key(px[k], py[k]); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k); });
  for (let u = 0; u < g.n; u++) {
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const pts = g.edgeCoords(e, u).map(([lon, lat]) => [lon * mLon, lat * M_LAT] as const);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      let best = radiusM * radiusM, bestK = -1;
      for (let cx = Math.floor((x0 - radiusM) / cell); cx <= Math.floor((x1 + radiusM) / cell); cx++) {
        for (let cy = Math.floor((y0 - radiusM) / cell); cy <= Math.floor((y1 + radiusM) / cell); cy++) {
          for (const k of grid.get(`${cx},${cy}`) ?? []) {
            for (let q = 1; q < pts.length; q++) {
              const d2 = segDist2(px[k], py[k], pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1]);
              if (d2 <= best) { best = d2; bestK = k; }
            }
          }
        }
      }
      out[e] = bestK;
    }
  }
  return out;
}

describe('motor route speed (F3-21)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the region median is sorted once per field array, not once per search', () => {
    const no2 = Float64Array.from({ length: g.m }, (_, e) => 10 + ((e * 7) % 13));
    const sort = vi.spyOn(Array.prototype, 'sort');
    const typedSort = vi.spyOn(Object.getPrototypeOf(Float64Array.prototype) as { sort: () => unknown }, 'sort');
    const a = optionsFor(g, 'walk', 0, 8, { no2 });
    for (let k = 0; k < 3; k++) optionsFor(g, 'walk', 0, 8, { no2 });
    expect(sort.mock.calls.length + typedSort.mock.calls.length).toBe(1);
    const b = optionsFor(g, 'walk', 0, 8, { no2 });
    const sorted = Array.from(no2).sort((x, y) => x - y), med = sorted[Math.floor(sorted.length / 2)];
    for (let e = 0; e < g.m; e++) {
      expect(b.exposureOf!(e)).toBe(no2[e] / med);
      expect(a.exposureOf!(e)).toBe(b.exposureOf!(e));
    }
  });

  it('the school of every edge is the same as before the faster grid, ties and far schools included', () => {
    const lats = Array.from({ length: g.n }, (_, u) => g.nodeLat(u)), lons = Array.from({ length: g.n }, (_, u) => g.nodeLon(u));
    const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    let s = 20261118;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let trial = 0; trial < 40; trial++) {
      const pts: Array<[number, number]> = Array.from({ length: 1 + (trial % 9) }, () =>
        [la0 - 0.0006 + r() * (la1 - la0 + 0.0012), lo0 - 0.0006 + r() * (lo1 - lo0 + 0.0012)]);
      if (trial % 4 === 0) pts.push([...pts[0]] as [number, number]); // two schools at one point: the tie keeps the later one
      for (const radius of [30, 50, 120]) expect(Array.from(schoolEdges(g, pts, radius))).toEqual(Array.from(schoolEdgesBefore(pts, radius)));
    }
    expect(Array.from(schoolEdges(g, []))).toEqual(Array.from(schoolEdgesBefore([])));
  });

  it('the faster median picks the same element as sorting with a comparator, gaps and infinities skipped (F3-22)', () => {
    let z = 7;
    const r = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 4294967296; };
    const before = (a: Float64Array) => { const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 1; };
    for (let t = 0; t < 200; t++) {
      const a = Float64Array.from({ length: 1 + Math.floor(r() * 300) }, () => {
        const u = r();
        return u < 0.1 ? Number.NaN : u < 0.12 ? Infinity : u < 0.14 ? -Infinity : u < 0.3 ? Math.round(r() * 5) : r() * 80 - 5;
      });
      expect(median(a)).toBe(before(a));
    }
    expect(median(new Float64Array([Number.NaN, Infinity]))).toBe(1);
    expect(median(new Float64Array(0))).toBe(1);
  });

  it('edgeXY writes the points of edgeCoords in their order, and asks for room when the arrays are short (F3-22)', () => {
    const mx = 110574 * Math.cos((-8.6 * Math.PI) / 180), my = 110574;
    let short = 0;
    for (let u = 0; u < g.n; u++) {
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        const c = g.edgeCoords(e, u);
        const tiny = new Float64Array(1);
        expect(g.edgeXY(e, u, mx, my, tiny, tiny)).toBe(-c.length);
        const xs = new Float64Array(c.length), ys = new Float64Array(c.length);
        expect(g.edgeXY(e, u, mx, my, xs, ys)).toBe(c.length);
        expect(Array.from(xs)).toEqual(c.map((p) => p[0] * mx));
        expect(Array.from(ys)).toEqual(c.map((p) => p[1] * my));
        if (c.length > 2) short++;
      }
    }
    expect(short).toBeGreaterThan(0); // the fixture has shape points, so the inner points and their reversal are covered
  });
});

describe('school grid size (F3-22)', () => {
  it('schools spread over a province still find the same nearest school within the radius', () => {
    // two far schools stretch the grid beyond 4 million cells of 50 m; the near ones must still be found
    const lat = g.nodeLat(0), lon = g.nodeLon(0);
    const near: Array<[number, number]> = [[lat + 0.0001, lon + 0.0001]];
    const wide: Array<[number, number]> = [...near, [lat - 1.5, lon - 1.5], [lat + 1.5, lon + 1.5]];
    const a = schoolEdges(g, near), b = schoolEdges(g, wide);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(a).some((k) => k === 0)).toBe(true);
  });
});
