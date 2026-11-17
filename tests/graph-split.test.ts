import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readContainer, splitGraph, writeContainer } from '../src/lib/route/graphSplit';
import { WalkGraph } from '../src/lib/route/walkGraph';
import { pareto, route } from '../src/lib/route/router';

// F1-56: the walking graph in two files, core first (routes) and shapes after (drawing).
const full = new Uint8Array(readFileSync('tests/fixtures/graph_small.bin'));
const g = new WalkGraph(full);
const { core, shapes } = splitGraph(full);

describe('splitGraph', () => {
  it('keeps every column, the core without the shapes and the shapes file with only them', () => {
    const c = readContainer(core), s = readContainer(shapes);
    expect(c.magic).toBe('BGR1');
    expect(s.magic).toBe('BSH1');
    expect(c.header.columns.map((x) => x.name)).toEqual(['lat', 'lon', 'off', 'target', 'len_dm', 'cls', 'ci']);
    expect(s.header.columns.map((x) => x.name)).toEqual(['sh', 'sh_off', 'sh_pts']);
    for (const name of ['lat', 'lon', 'off', 'target', 'len_dm', 'cls', 'ci']) expect([...c.column(name)!]).toEqual([...readContainer(full).column(name)!]);
    for (const name of ['sh', 'sh_off', 'sh_pts']) expect([...s.column(name)!]).toEqual([...readContainer(full).column(name)!]);
    for (const x of [...c.header.columns, ...s.header.columns]) expect(x.offset % 8).toBe(0);
    expect(c.header.parts).toBe('inti');
  });
  it('refuses a file that is not a graph', () => {
    expect(() => splitGraph(new TextEncoder().encode('XXXX\u0002\u0000\u0000\u0000{}'))).toThrow('not a BGR1');
    expect(() => writeContainer('BG', {}, [])).toThrow('4 characters');
  });
});

describe('WalkGraph from the core, shapes attached later', () => {
  it('routes exactly as the full graph before the shapes arrive', () => {
    const k = new WalkGraph(core);
    expect(k.hasShapes).toBe(false);
    expect([k.n, k.m]).toEqual([g.n, g.m]);
    const dirty = (e: number) => 1 + (e % 3);
    for (let s = 0; s < g.n; s++) {
      for (let t = 0; t < g.n; t++) {
        if (s === t) continue;
        const a = route(g, s, t, 0, { speed: 1.3 }), b = route(k, s, t, 0, { speed: 1.3 });
        expect(b?.edges).toEqual(a?.edges);
        expect(pareto(k, s, t, { speed: 1.3, exposureOf: dirty }).map((r) => r.edges)).toEqual(pareto(g, s, t, { speed: 1.3, exposureOf: dirty }).map((r) => r.edges));
      }
    }
  });
  it('draws an edge as a straight line between its nodes, then with its real shape', () => {
    const k = new WalkGraph(core);
    const xs = new Float64Array(64), ys = new Float64Array(64), xf = new Float64Array(64), yf = new Float64Array(64);
    for (let u = 0; u < g.n; u++) {
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        const v = g.target[e];
        expect(k.edgeCoords(e, u)).toEqual([[g.nodeLon(u), g.nodeLat(u)], [g.nodeLon(v), g.nodeLat(v)]]);
        expect(k.edgeXY(e, u, 1, 1, xs, ys)).toBe(2);
      }
    }
    k.attachShapes(shapes);
    expect(k.hasShapes).toBe(true);
    for (let u = 0; u < g.n; u++) {
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        expect(k.edgeCoords(e, u)).toEqual(g.edgeCoords(e, u));
        const n = k.edgeXY(e, u, 2, 3, xs, ys);
        expect(n).toBe(g.edgeXY(e, u, 2, 3, xf, yf));
        expect([...xs.subarray(0, n)]).toEqual([...xf.subarray(0, n)]);
        expect([...ys.subarray(0, n)]).toEqual([...yf.subarray(0, n)]);
      }
    }
  });
  it('refuses shapes of another graph', () => {
    const { header, column } = readContainer(shapes);
    const other = writeContainer('BSH1', { ...header, m: (header.m as number) + 1 }, header.columns.map((c) => ({ name: c.name, dtype: c.dtype, count: c.count, data: column(c.name)! })));
    expect(() => new WalkGraph(core).attachShapes(other)).toThrow('another graph');
    expect(() => new WalkGraph(core).attachShapes(core)).toThrow('BSH1');
  });
});
