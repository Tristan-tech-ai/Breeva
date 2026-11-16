import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WalkGraph } from '../src/lib/route/walkGraph';

// Written by vayu/field/make_graph_fixture.py with the Python writer (vayu/field/graph.py).
const g = new WalkGraph(new Uint8Array(readFileSync('tests/fixtures/graph_small.bin')));
const want = JSON.parse(readFileSync('tests/fixtures/graph_small.json', 'utf8')) as {
  n: number; m: number; nodes: number[][];
  edges: Array<{ e: number; u: number; v: number; len_dm: number; cls: number; ci: number; coords: number[][] }>;
};

describe('walking graph reader (TypeScript) against the Python writer', () => {
  it('reads the header and the nodes', () => {
    expect(g.meta.format).toBe('BGR1');
    expect([g.n, g.m]).toEqual([want.n, want.m]);
    want.nodes.forEach(([lon, lat], u) => {
      expect(g.nodeLon(u)).toBeCloseTo(lon, 6);
      expect(g.nodeLat(u)).toBeCloseTo(lat, 6);
    });
  });

  it('reads every directed edge: CSR, length, class, road link and shape', () => {
    for (const w of want.edges) {
      expect(w.e).toBeGreaterThanOrEqual(g.off[w.u]);
      expect(w.e).toBeLessThan(g.off[w.u + 1]);
      expect(g.target[w.e]).toBe(w.v);
      expect(g.lenDm[w.e]).toBe(w.len_dm);
      expect(g.cls[w.e]).toBe(w.cls);
      expect(g.ci[w.e]).toBe(w.ci);
      const co = g.edgeCoords(w.e, w.u);
      expect(co.length).toBe(w.coords.length);
      co.forEach((p, q) => { expect(p[0]).toBeCloseTo(w.coords[q][0], 6); expect(p[1]).toBeCloseTo(w.coords[q][1], 6); });
    }
    expect(want.edges.length).toBe(g.m);
  });

  it('decodes classes and the road link', () => {
    const e = want.edges[0].e;
    const r = g.road(e)!;
    expect(r.c).toBe(1);
    expect((r.c << 20) | r.i).toBe(want.edges[0].ci);
    const kinds = new Set(want.edges.map((w) => g.highway(w.e)));
    expect(kinds).toEqual(new Set(['residential', 'footway', 'steps', 'primary']));
    const steps = want.edges.find((w) => g.highway(w.e) === 'steps')!;
    expect(g.isSteps(steps.e) && g.isFootway(steps.e)).toBe(true);
  });
});

describe('the Badung-Denpasar walking graph', () => {
  const path = 'D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.bin';
  let bytes: Uint8Array | null = null;
  try { bytes = new Uint8Array(readFileSync(path)); } catch { bytes = null; }
  it.runIf(bytes !== null)('is one connected graph whose edges mostly link to field roads', () => {
    const big = new WalkGraph(bytes!);
    expect(big.n).toBeGreaterThan(30000);
    let linked = 0;
    for (let e = 0; e < big.m; e++) if (big.road(e)) linked++;
    expect(linked / big.m).toBeGreaterThan(0.95);
    // BFS from node 0 reaches every node (the pack keeps only the largest component).
    const seen = new Uint8Array(big.n); const q = [0]; seen[0] = 1;
    while (q.length) { const u = q.pop()!; for (let e = big.off[u]; e < big.off[u + 1]; e++) { const v = big.target[e]; if (!seen[v]) { seen[v] = 1; q.push(v); } } }
    expect(seen.reduce((s, x) => s + x, 0)).toBe(big.n);
  });
});
