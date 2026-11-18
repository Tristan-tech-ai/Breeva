import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCore, encodeCore, isEncodedCore } from '../src/lib/route/coreCodec';
import { writeContainer } from '../src/lib/route/graphSplit';
import { WalkGraph } from '../src/lib/route/walkGraph';

// F1-61: the BGC1 core must give back the BGR1 core byte for byte.
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** A BGR1 core from an edge list given per node (CSR order), with per-edge length, class and cell. */
function core(nodes: Array<[number, number]>, adj: Array<Array<[number, number, number, number]>>): Uint8Array {
  const n = nodes.length, m = adj.reduce((s, a) => s + a.length, 0);
  const off = new Uint32Array(n + 1), target = new Uint32Array(m), len = new Uint16Array(m), cls = new Uint8Array(m), ci = new Uint32Array(m);
  let e = 0;
  adj.forEach((a, u) => { for (const [v, l, c, k] of a) { target[e] = v; len[e] = l; cls[e] = c; ci[e] = k; e++; } off[u + 1] = e; });
  const header = { format: 'BGR1', geometry: 'g', region: 'r', name: 'r', n, m, coord_scale: 1e6, parts: 'inti' };
  return writeContainer('BGR1', header, [
    { name: 'lat', dtype: '<i4', count: n, data: bytes(Int32Array.from(nodes, (p) => p[0])) },
    { name: 'lon', dtype: '<i4', count: n, data: bytes(Int32Array.from(nodes, (p) => p[1])) },
    { name: 'off', dtype: '<u4', count: n + 1, data: bytes(off) },
    { name: 'target', dtype: '<u4', count: m, data: bytes(target) },
    { name: 'len_dm', dtype: '<u2', count: m, data: bytes(len) },
    { name: 'cls', dtype: '<u1', count: m, data: cls },
    { name: 'ci', dtype: '<u4', count: m, data: bytes(ci) },
  ]);
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const header = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + new DataView(b.buffer, b.byteOffset).getUint32(4, true)))) as { ex: number };

describe('BGC1 core graph', () => {
  const nodes: Array<[number, number]> = [[-8670000, 115210000], [-8670100, 115210400], [-8669800, 115209900], [-8671000, 115211000]];
  it('gives back the BGR1 core byte for byte, with parallel edges and a self loop', () => {
    // 0-1 twice (two parallel ways of different length), 0-2, 1-3, a self loop on 2; every edge both ways
    const c = core(nodes, [
      [[1, 120, 2, 7], [2, 55, 1, 4294967295], [1, 300, 3, 8]],
      [[0, 120, 2, 7], [0, 300, 3, 8], [3, 900, 0, 9]],
      [[0, 55, 1, 4294967295], [2, 10, 1, 4]],
      [[1, 900, 0, 9]],
    ]);
    const enc = encodeCore(c);
    expect(isEncodedCore(enc)).toBe(true);
    expect(header(enc).ex).toBe(0);
    expect(same(decodeCore(enc), c)).toBe(true);
    const g = new WalkGraph(decodeCore(enc));
    expect(Array.from(g.lenDm)).toEqual([120, 55, 300, 120, 300, 900, 55, 10, 900]);
  });
  it('keeps a reverse edge that differs from its partner as an exception', () => {
    const c = core(nodes.slice(0, 2), [[[1, 120, 2, 7]], [[0, 125, 2, 7]]]); // a one-way difference in length
    const enc = encodeCore(c);
    expect(header(enc).ex).toBe(1);
    expect(same(decodeCore(enc), c)).toBe(true);
    const lone = core(nodes.slice(0, 2), [[], [[0, 40, 1, 3]]]); // a reverse edge with no partner at all
    expect(header(encodeCore(lone)).ex).toBe(1);
    expect(same(decodeCore(encodeCore(lone)), lone)).toBe(true);
  });
  it('passes a BGR1 core through, and refuses what it cannot write', () => {
    const c = core(nodes.slice(0, 2), [[[1, 120, 2, 7]], [[0, 120, 2, 7]]]);
    expect(decodeCore(c)).toBe(c);
    const many = Array.from({ length: 257 }, (_, i) => [-8670000 + i, 115210000 + i] as [number, number]);
    const star = core(many, [Array.from({ length: 256 }, (_, i) => [i + 1, 10, 1, 1] as [number, number, number, number]), ...Array.from({ length: 256 }, () => [[0, 10, 1, 1] as [number, number, number, number]])]);
    expect(() => encodeCore(star)).toThrow(/degree/);
    const cut = encodeCore(c).slice(0, -1);
    expect(() => decodeCore(cut)).toThrow();
  });
  it.skipIf(!existsSync('D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar_inti.bin'))('round-trips the published Badung–Denpasar core', () => {
    const c = new Uint8Array(readFileSync('D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar_inti.bin'));
    const enc = encodeCore(c);
    expect(same(decodeCore(enc), c)).toBe(true);
    expect(enc.length).toBeLessThan(c.length * 0.5);
  });
});
