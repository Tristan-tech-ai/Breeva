/**
 * A smaller wire form of the edge shapes (F1-62). A first motor route waits for the shapes (school zones are found from
 * them, F3-07), and on a slow 3G link the BSH1 file (F1-56) is the last one it waits for. Every shape belongs to one
 * pair of directed edges (the reverse edge draws it backwards), and its points sit next to the edge's own end nodes, so
 * the shapes are written against the core graph they belong to (BSC1):
 *   rev   one bit per "primary" edge (source <= target): its shape runs backwards
 *   cnt   points per shape, as varints, the shapes numbered in primary-edge order
 *   x, y  zigzag deltas, the first point of a shape from the edge's start node, as varints
 *   ex_*  reverse edges that do not simply draw their partner's shape backwards, with their own shape and direction
 * decodeShapes() rebuilds a BSH1 file with the shapes renumbered in that order: every edge gets exactly the polyline the
 * original gave it (scripts/field/split-graph.mts checks all edges), the numbering itself is not kept.
 */
import { bytesOf, getVarints, partners, putVarints, unzz, zz } from './coreCodec';
import { readContainer, writeContainer } from './graphSplit';

/** What the shape codec needs of the core graph (WalkGraph has it). */
export interface ShapeGraph {
  n: number; m: number; off: ArrayLike<number>; target: ArrayLike<number>; lat: ArrayLike<number>; lon: ArrayLike<number>;
  meta: { region: string; geometry: string };
}
interface Section { name: string; offset: number; length: number }
interface ShapeHeader { base: Record<string, unknown>; m: number; n: number; shapes: number; points: number; ex: number; sections: Section[] }

const sources = (g: ShapeGraph) => {
  const src = new Uint32Array(g.m);
  for (let u = 0; u < g.n; u++) for (let e = g.off[u]; e < g.off[u + 1]; e++) src[e] = u;
  return src;
};

export const isEncodedShapes = (b: Uint8Array) => b.length >= 4 && b[0] === 0x42 && b[1] === 0x53 && b[2] === 0x43 && b[3] === 0x31; // 'BSC1'

/** BSH1 -> BSC1 against its core graph. Throws when a shape is not owned by exactly one primary edge (keep BSH1 then). */
export function encodeShapes(bsh1: Uint8Array, g: ShapeGraph): Uint8Array {
  const { magic, header, column } = readContainer(bsh1);
  if (magic !== 'BSH1') throw new Error('not a BSH1 shapes file');
  if (header.m !== g.m || header.region !== g.meta.region || header.geometry !== g.meta.geometry) throw new Error('shapes belong to another graph');
  const sh = new Uint32Array(column('sh')!.slice().buffer), off = new Uint32Array(column('sh_off')!.slice().buffer), pts = new Int32Array(column('sh_pts')!.slice().buffer);
  const shapes = off.length - 1, src = sources(g), part = partners(g.off, g.target, g.n);
  const newOf = new Int32Array(shapes).fill(-1);
  const order: number[] = [], rev: number[] = [];
  for (let e = 0; e < g.m; e++) {
    if (src[e] > g.target[e]) continue;
    const k = sh[e] >>> 1;
    if (newOf[k] >= 0) throw new Error('shapes: a shape owned by two primary edges');
    newOf[k] = order.length; order.push(e); rev.push(sh[e] & 1);
  }
  if (order.length !== shapes) throw new Error('shapes: a shape without a primary edge');
  const exIdx: number[] = [], exSh: number[] = [];
  for (let e = 0; e < g.m; e++) {
    if (src[e] <= g.target[e]) continue;
    const f = part[e];
    if (f >= 0 && sh[e] === (sh[f] ^ 1)) continue;
    exIdx.push(e); exSh.push((newOf[sh[e] >>> 1] << 1) | (sh[e] & 1));
  }
  const revBits = new Uint8Array(Math.ceil(order.length / 8));
  rev.forEach((r, i) => { if (r) revBits[i >> 3] |= 1 << (i & 7); });
  const cnt = new Uint32Array(shapes), dx: number[] = [], dy: number[] = [];
  order.forEach((e, i) => {
    const k = sh[e] >>> 1, a = off[k], b = off[k + 1];
    cnt[i] = b - a;
    const node = rev[i] ? g.target[e] : src[e];
    let px = g.lon[node], py = g.lat[node];
    for (let q = a; q < b; q++) { dx.push(zz(pts[2 * q] - px)); dy.push(zz(pts[2 * q + 1] - py)); px = pts[2 * q]; py = pts[2 * q + 1]; }
  });
  const sections: Array<[string, Uint8Array]> = [
    ['rev', revBits], ['cnt', putVarints(cnt)], ['x', putVarints(dx)], ['y', putVarints(dy)],
    ['ex_idx', bytesOf(Uint32Array.from(exIdx))], ['ex_sh', bytesOf(Uint32Array.from(exSh))],
  ];
  const base = Object.fromEntries(Object.entries(header).filter(([key]) => key !== 'columns'));
  let at = 0;
  const secs = sections.map(([name, b]) => { const s = { name, offset: at, length: b.byteLength }; at += b.byteLength; return s; });
  const head = new TextEncoder().encode(JSON.stringify({ base, m: g.m, n: g.n, shapes, points: pts.length / 2, ex: exIdx.length, sections: secs } satisfies ShapeHeader));
  const out = new Uint8Array(8 + head.length + at);
  out.set(new TextEncoder().encode('BSC1'), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  sections.forEach(([, b], k) => out.set(b, 8 + head.length + secs[k].offset));
  return out;
}

/** BSC1 -> a BSH1 file for WalkGraph.attachShapes (shapes numbered in primary-edge order). A BSH1 passes through. */
export function decodeShapes(bytes: Uint8Array, g: ShapeGraph): Uint8Array {
  if (!isEncodedShapes(bytes)) return bytes;
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as ShapeHeader;
  if (h.m !== g.m || h.n !== g.n) throw new Error('shapes belong to another graph');
  const body = 8 + hl;
  const sec = (name: string) => { const s = h.sections.find((x) => x.name === name); if (!s) throw new Error(`shapes: no section ${name}`); return bytes.subarray(body + s.offset, body + s.offset + s.length); };
  const revBits = sec('rev'), cnt = getVarints(sec('cnt'), h.shapes);
  const dx = getVarints(sec('x'), h.points), dy = getVarints(sec('y'), h.points);
  const exIdx = new Uint32Array(sec('ex_idx').slice().buffer), exSh = new Uint32Array(sec('ex_sh').slice().buffer);
  if (exIdx.length !== h.ex || exSh.length !== h.ex) throw new Error('shapes: exception count');
  const src = sources(g), part = partners(g.off, g.target, g.n);
  const sh = new Uint32Array(g.m), off = new Uint32Array(h.shapes + 1), pts = new Int32Array(2 * h.points);
  let k = 0, q = 0, x = 0;
  for (let e = 0; e < g.m; e++) {
    if (src[e] <= g.target[e]) {
      if (k >= h.shapes) throw new Error('shapes: more primary edges than shapes');
      const r = (revBits[k >> 3] >> (k & 7)) & 1;
      sh[e] = (k << 1) | r;
      const node = r ? g.target[e] : src[e];
      let px = g.lon[node], py = g.lat[node];
      for (let j = 0; j < cnt[k]; j++, q++) { px += unzz(dx[q]); py += unzz(dy[q]); pts[2 * q] = px; pts[2 * q + 1] = py; }
      off[++k] = q;
      continue;
    }
    if (x < h.ex && exIdx[x] === e) { sh[e] = exSh[x++]; continue; }
    const f = part[e];
    if (f < 0) throw new Error('shapes: reverse edge without a partner');
    sh[e] = sh[f] ^ 1;
  }
  if (k !== h.shapes || q !== h.points || x !== h.ex) throw new Error('shapes: values left over');
  return writeContainer('BSH1', h.base, [
    { name: 'sh', dtype: '<u4', count: g.m, data: bytesOf(sh) },
    { name: 'sh_off', dtype: '<u4', count: h.shapes + 1, data: bytesOf(off) },
    { name: 'sh_pts', dtype: '<i4', count: 2 * h.points, data: bytesOf(pts) },
  ]);
}
