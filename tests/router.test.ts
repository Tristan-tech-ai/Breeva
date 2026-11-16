import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WalkGraph } from '../src/lib/route/walkGraph';
import { NodeIndex, pareto, route, sourceOf } from '../src/lib/route/router';
import { cachedBytes } from '../src/lib/route/assets';

// 3 x 3 grid written by the Python writer (vayu/field/make_graph_fixture.py)
const g = new WalkGraph(new Uint8Array(readFileSync('tests/fixtures/graph_small.bin')));

function dijkstra(s: number, cost: (e: number) => number): Float64Array {
  const d = new Float64Array(g.n).fill(Infinity); d[s] = 0;
  const done = new Uint8Array(g.n);
  for (;;) {
    let u = -1;
    for (let k = 0; k < g.n; k++) if (!done[k] && (u < 0 || d[k] < d[u])) u = k;
    if (u < 0 || !Number.isFinite(d[u])) break;
    done[u] = 1;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) d[g.target[e]] = Math.min(d[g.target[e]], d[u] + cost(e));
  }
  return d;
}

describe('router', () => {
  it('A* finds the same shortest lengths as plain Dijkstra for every pair', () => {
    for (let s = 0; s < g.n; s++) {
      const d = dijkstra(s, (e) => g.lenDm[e] / 10);
      for (let t = 0; t < g.n; t++) {
        if (s === t) continue;
        const r = route(g, s, t, 0, { speed: 1.3 })!;
        expect(r.lengthM).toBeCloseTo(d[t], 6);
        expect(r.nodes[0]).toBe(s); expect(r.nodes.at(-1)).toBe(t);
        r.edges.forEach((e, k) => { expect(sourceOf(g, e)).toBe(r.nodes[k]); expect(g.target[e]).toBe(r.nodes[k + 1]); });
      }
    }
  });

  it('a high exposure weight trades time for exposure, and pareto returns the trade-off fastest first', () => {
    // the middle row by latitude (node ids follow a Hilbert curve, not the grid); its edges are dirty
    const lats = [...new Set(Array.from({ length: g.n }, (_, u) => g.nodeLat(u).toFixed(6)))].sort();
    const mid = Array.from({ length: g.n }, (_, u) => u).filter((u) => g.nodeLat(u).toFixed(6) === lats[1]).sort((x, y) => g.nodeLon(x) - g.nodeLon(y));
    const midSet = new Set(mid);
    const dirty = (e: number) => (midSet.has(sourceOf(g, e)) && midSet.has(g.target[e]) ? 10 : 0.1);
    const [s, t] = [mid[0], mid[mid.length - 1]];
    const fast = route(g, s, t, 0, { speed: 1.3, exposureOf: dirty })!;
    const clean = route(g, s, t, 50, { speed: 1.3, exposureOf: dirty })!;
    expect(clean.exposure).toBeLessThan(fast.exposure);
    expect(clean.timeS).toBeGreaterThan(fast.timeS);
    const rs = pareto(g, s, t, { speed: 1.3, exposureOf: dirty, wMax: 50 });
    expect(rs.length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < rs.length; k++) { expect(rs[k].timeS).toBeGreaterThanOrEqual(rs[k - 1].timeS); expect(rs[k].exposure).toBeLessThanOrEqual(rs[k - 1].exposure); }
  });

  it('snaps a point to its nearest node and refuses points far from the network', () => {
    const idx = new NodeIndex(g);
    expect(idx.nearest(g.nodeLat(4) + 0.00005, g.nodeLon(4) - 0.00004)).toBe(4);
    expect(idx.nearest(g.nodeLat(4) + 0.05, g.nodeLon(4), 500)).toBe(-1);
  });
});

describe('route assets cache', () => {
  function memCache() {
    const m = new Map<string, Response>();
    return { match: async (u: string) => m.get(u)?.clone(), put: async (u: string, r: Response) => { m.set(u, r); } };
  }
  const bytes = new Uint8Array([1, 2, 3]);
  const ok = async () => new Response(bytes);
  const offline = async () => { throw new TypeError('Failed to fetch'); };

  it('serves from the cache when the network is gone, after one online fetch', async () => {
    const cache = memCache();
    await cachedBytes('https://x/graph.bin', { cacheFirst: true, fetchImpl: ok as unknown as typeof fetch, cache: cache as unknown as Cache });
    const again = await cachedBytes('https://x/graph.bin', { cacheFirst: true, fetchImpl: offline as unknown as typeof fetch, cache: cache as unknown as Cache });
    expect(Array.from(again)).toEqual([1, 2, 3]);
    const man = await cachedBytes('https://x/graph.bin', { cacheFirst: false, fetchImpl: offline as unknown as typeof fetch, cache: cache as unknown as Cache });
    expect(Array.from(man)).toEqual([1, 2, 3]); // network first falls back to the cache
    await expect(cachedBytes('https://x/other.bin', { cacheFirst: true, fetchImpl: offline as unknown as typeof fetch, cache: cache as unknown as Cache })).rejects.toThrow();
  });
});
