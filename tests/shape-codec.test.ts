import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeContainer } from '../src/lib/route/graphSplit';
import { decodeShapes, encodeShapes, isEncodedShapes } from '../src/lib/route/shapeCodec';
import { WalkGraph } from '../src/lib/route/walkGraph';

// F1-62: with the BSC1 shapes every edge must get the polyline the BSH1 file gave it.
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const META = { format: 'BGR1', geometry: 'g', region: 'r', name: 'r', coord_scale: 1e6, parts: 'inti' };

function core(nodes: Array<[number, number]>, adj: number[][]): Uint8Array {
  const n = nodes.length, m = adj.reduce((s, a) => s + a.length, 0);
  const off = new Uint32Array(n + 1), target = new Uint32Array(m);
  let e = 0;
  adj.forEach((a, u) => { for (const v of a) target[e++] = v; off[u + 1] = e; });
  return writeContainer('BGR1', { ...META, n, m }, [
    { name: 'lat', dtype: '<i4', count: n, data: bytes(Int32Array.from(nodes, (p) => p[0])) },
    { name: 'lon', dtype: '<i4', count: n, data: bytes(Int32Array.from(nodes, (p) => p[1])) },
    { name: 'off', dtype: '<u4', count: n + 1, data: bytes(off) },
    { name: 'target', dtype: '<u4', count: m, data: bytes(target) },
    { name: 'len_dm', dtype: '<u2', count: m, data: new Uint8Array(2 * m) },
    { name: 'cls', dtype: '<u1', count: m, data: new Uint8Array(m) },
    { name: 'ci', dtype: '<u4', count: m, data: new Uint8Array(4 * m) },
  ]);
}

/** BSH1 shapes: sh per edge, then the inner points of each shape as [lat, lon] pairs. */
function shapesFile(sh: number[], shapes: Array<Array<[number, number]>>): Uint8Array {
  const off = [0];
  const pts: number[] = [];
  for (const s of shapes) { for (const [la, lo] of s) pts.push(lo, la); off.push(pts.length / 2); }
  return writeContainer('BSH1', { format: 'BSH1', region: 'r', geometry: 'g', m: sh.length, shapes: shapes.length }, [
    { name: 'sh', dtype: '<u4', count: sh.length, data: bytes(Uint32Array.from(sh)) },
    { name: 'sh_off', dtype: '<u4', count: off.length, data: bytes(Uint32Array.from(off)) },
    { name: 'sh_pts', dtype: '<i4', count: pts.length, data: bytes(Int32Array.from(pts)) },
  ]);
}

const lines = (g: WalkGraph) => { const out: string[] = []; for (let u = 0; u < g.n; u++) for (let e = g.off[u]; e < g.off[u + 1]; e++) out.push(JSON.stringify(g.edgeCoords(e, u))); return out; };
const nodes: Array<[number, number]> = [[-8670000, 115210000], [-8670100, 115210400], [-8669800, 115209900]];
// edges in CSR order: 0->1, 0->2, 1->0, 2->0; shapes stored in another order than the primary edges
const c = core(nodes, [[1, 2], [0], [0]]);
const S = [[[-8669900, 115209950]], [[-8670030, 115210100], [-8670070, 115210300]]] as Array<Array<[number, number]>>;

describe('BSC1 shapes', () => {
  it('gives every edge the same polyline, the shapes renumbered in primary-edge order', () => {
    // 0->1 uses shape 1 forwards, 0->2 shape 0 forwards, 1->0 shape 1 backwards, 2->0 shape 0 backwards
    const shp = shapesFile([2, 0, 3, 1], S);
    const a = new WalkGraph(c); a.attachShapes(shp);
    const b = new WalkGraph(c);
    const enc = encodeShapes(shp, b);
    expect(isEncodedShapes(enc)).toBe(true);
    b.attachShapes(decodeShapes(enc, b));
    expect(lines(b)).toEqual(lines(a));
  });
  it('keeps a reverse edge that does not draw its partner backwards, and a shape stored backwards', () => {
    // 2->0 draws shape 0 forwards (not its partner backwards); 0->1 owns shape 1 stored from node 1 to node 0
    const shp = shapesFile([3, 0, 2, 0], S);
    const a = new WalkGraph(c); a.attachShapes(shp);
    const b = new WalkGraph(c);
    const enc = encodeShapes(shp, b);
    expect(JSON.parse(new TextDecoder().decode(enc.subarray(8, 8 + new DataView(enc.buffer).getUint32(4, true)))).ex).toBe(1);
    b.attachShapes(decodeShapes(enc, b));
    expect(lines(b)).toEqual(lines(a));
  });
  it('refuses shapes it cannot write and shapes of another graph, and passes BSH1 through', () => {
    const g = new WalkGraph(c);
    expect(() => encodeShapes(shapesFile([0, 0, 1, 1], S), g)).toThrow(/two primary edges/);
    expect(() => encodeShapes(shapesFile([0, 2, 1, 3], [...S, [[1, 1]]]), g)).toThrow(/without a primary edge/);
    const other = new WalkGraph(core(nodes, [[1], [0], []]));
    expect(() => decodeShapes(encodeShapes(shapesFile([2, 0, 3, 1], S), g), other)).toThrow(/another graph/);
    const shp = shapesFile([2, 0, 3, 1], S);
    expect(decodeShapes(shp, g)).toBe(shp);
  });
  it.skipIf(!existsSync('D:/breeva-ml-data/field/graphs/2026-11/kota_bogor_bentuk.bin'))('matches every Kota Bogor edge and halves the file', () => {
    const D = 'D:/breeva-ml-data/field/graphs/2026-11';
    const core2 = new Uint8Array(readFileSync(`${D}/kota_bogor_inti.bin`)), shp = new Uint8Array(readFileSync(`${D}/kota_bogor_bentuk.bin`));
    const a = new WalkGraph(core2); a.attachShapes(shp);
    const b = new WalkGraph(core2);
    const enc = encodeShapes(shp, b);
    b.attachShapes(decodeShapes(enc, b));
    expect(lines(b)).toEqual(lines(a));
    expect(enc.length).toBeLessThan(shp.length * 0.3);
  });
});
