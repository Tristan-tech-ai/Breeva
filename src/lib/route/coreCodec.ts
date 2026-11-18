/**
 * A smaller wire form of the core walking graph (F1-61). On a slow 3G link the core graph (BGR1 without shapes, F1-56)
 * is the last file a first walking route waits for. Every walking edge is stored in both directions with the same
 * length, class and cell, the node degrees fit in a byte, and coordinates and targets are close to their neighbours,
 * so the core is written as (BGC1):
 *   deg       u1 per node (instead of the u4 CSR offsets)
 *   lat, lon  zigzag deltas from the previous node, as varints
 *   target    zigzag (target - source node), as varints
 *   len, cls, ci  only for "primary" edges (source <= target); the reverse edge of a pair takes them from its partner
 *   exceptions    reverse edges whose partner is missing or differs, with their own values
 * decodeCore() gives back the BGR1 core byte for byte, so nothing else changes. Container: 'BGC1', u32 header length
 * (little endian), JSON header, then the sections at the offsets the header names.
 */
import { readContainer, writeContainer } from './graphSplit';

interface Section { name: string; offset: number; length: number }
interface CoreHeader { base: Record<string, unknown> & { columns: Array<{ name: string; dtype: string; count: number }> }; n: number; m: number; ex: number; sections: Section[] }

export const zz = (v: number) => ((v << 1) ^ (v >> 31)) >>> 0;
export const unzz = (v: number) => (v >>> 1) ^ -(v & 1);

export function putVarints(vals: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(vals.length * 5);
  let k = 0;
  for (let i = 0; i < vals.length; i++) {
    let v = vals[i] >>> 0;
    while (v >= 0x80) { out[k++] = (v & 0x7f) | 0x80; v >>>= 7; }
    out[k++] = v;
  }
  return out.slice(0, k);
}

export function getVarints(b: Uint8Array, count: number): Uint32Array {
  const out = new Uint32Array(count);
  let k = 0;
  for (let i = 0; i < count; i++) {
    let v = 0, shift = 0, x: number;
    do { if (k >= b.length) throw new Error('core graph: varints cut short'); x = b[k++]; v += (x & 0x7f) * 2 ** shift; shift += 7; } while (x & 0x80);
    out[i] = v;
  }
  if (k !== b.length) throw new Error('core graph: trailing varint bytes');
  return out;
}

export const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const copyAs = <T>(C: new (b: ArrayBuffer) => T, b: Uint8Array): T => C === (Uint8Array as unknown) ? (b.slice() as unknown as T) : new C(b.slice().buffer);

/** The partner of each reverse edge (source > target): the k-th edge back from the target, k its rank among the parallels. */
export function partners(off: ArrayLike<number>, target: ArrayLike<number>, n: number): Int32Array {
  const p = new Int32Array(target.length).fill(-1);
  for (let u = 0; u < n; u++) {
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = target[e];
      if (u <= v) continue;
      let k = 0;
      for (let f = off[u]; f < e; f++) if (target[f] === v) k++;
      for (let f = off[v]; f < off[v + 1]; f++) if (target[f] === u && k-- === 0) { p[e] = f; break; }
    }
  }
  return p;
}

/** BGR1 core (without shape columns) -> BGC1. Throws when a node has more than 255 edges (keep BGR1 then). */
export function encodeCore(core: Uint8Array): Uint8Array {
  const { magic, header, column } = readContainer(core);
  if (magic !== 'BGR1') throw new Error('not a BGR1 graph');
  const n = header.n as number, m = header.m as number;
  const col = <T>(name: string, C: new (b: ArrayBuffer) => T) => { const b = column(name); if (!b) throw new Error(`core graph: no ${name}`); return copyAs(C, b); };
  const lat = col('lat', Int32Array), lon = col('lon', Int32Array), off = col('off', Uint32Array), target = col('target', Uint32Array);
  const lenDm = col('len_dm', Uint16Array), cls = col('cls', Uint8Array), ci = col('ci', Uint32Array);
  const names = header.columns.map((c) => c.name).join(',');
  if (names !== 'lat,lon,off,target,len_dm,cls,ci') throw new Error(`core graph: unexpected columns ${names}`);
  const deg = new Uint8Array(n);
  for (let u = 0; u < n; u++) { const d = off[u + 1] - off[u]; if (d > 255) throw new Error('core graph: degree over 255'); deg[u] = d; }
  const dLat = new Uint32Array(n), dLon = new Uint32Array(n);
  for (let u = 0; u < n; u++) { dLat[u] = zz(lat[u] - (u ? lat[u - 1] : 0)); dLon[u] = zz(lon[u] - (u ? lon[u - 1] : 0)); }
  const rel = new Uint32Array(m);
  const pLen: number[] = [], pCls: number[] = [], pCi: number[] = [];
  const exIdx: number[] = [], exLen: number[] = [], exCls: number[] = [], exCi: number[] = [];
  const part = partners(off, target, n);
  for (let u = 0; u < n; u++) {
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = target[e];
      rel[e] = zz(v - u);
      if (u <= v) { pLen.push(lenDm[e]); pCls.push(cls[e]); pCi.push(ci[e]); continue; }
      const f = part[e];
      if (f >= 0 && lenDm[f] === lenDm[e] && cls[f] === cls[e] && ci[f] === ci[e]) continue;
      exIdx.push(e); exLen.push(lenDm[e]); exCls.push(cls[e]); exCi.push(ci[e]);
    }
  }
  const sections: Array<[string, Uint8Array]> = [
    ['deg', deg], ['lat', putVarints(dLat)], ['lon', putVarints(dLon)], ['target', putVarints(rel)],
    ['len', bytesOf(Uint16Array.from(pLen))], ['cls', Uint8Array.from(pCls)], ['ci', bytesOf(Uint32Array.from(pCi))],
    ['ex_idx', bytesOf(Uint32Array.from(exIdx))], ['ex_len', bytesOf(Uint16Array.from(exLen))], ['ex_cls', Uint8Array.from(exCls)], ['ex_ci', bytesOf(Uint32Array.from(exCi))],
  ];
  const { columns, ...rest } = header;
  const base = { ...rest, columns: columns.map(({ name, dtype, count }) => ({ name, dtype, count })) };
  let at = 0;
  const secs = sections.map(([name, b]) => { const s = { name, offset: at, length: b.byteLength }; at += b.byteLength; return s; });
  const head = new TextEncoder().encode(JSON.stringify({ base, n, m, ex: exIdx.length, sections: secs } satisfies CoreHeader));
  const out = new Uint8Array(8 + head.length + at);
  out.set(new TextEncoder().encode('BGC1'), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  sections.forEach(([, b], k) => out.set(b, 8 + head.length + secs[k].offset));
  return out;
}

export const isEncodedCore = (b: Uint8Array) => b.length >= 4 && b[0] === 0x42 && b[1] === 0x47 && b[2] === 0x43 && b[3] === 0x31; // 'BGC1'

/** BGC1 -> the BGR1 core it was made from, byte for byte. A BGR1 core passes through unchanged. */
export function decodeCore(bytes: Uint8Array): Uint8Array {
  if (!isEncodedCore(bytes)) return bytes;
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as CoreHeader;
  const body = 8 + hl;
  const sec = (name: string) => { const s = h.sections.find((x) => x.name === name); if (!s) throw new Error(`core graph: no section ${name}`); return bytes.subarray(body + s.offset, body + s.offset + s.length); };
  const { n, m, ex } = h;
  const deg = sec('deg');
  const off = new Uint32Array(n + 1);
  for (let u = 0; u < n; u++) off[u + 1] = off[u] + deg[u];
  if (off[n] !== m) throw new Error('core graph: degrees do not add up to the edge count');
  const lat = new Int32Array(n), lon = new Int32Array(n);
  const dLat = getVarints(sec('lat'), n), dLon = getVarints(sec('lon'), n);
  for (let u = 0; u < n; u++) { lat[u] = (u ? lat[u - 1] : 0) + unzz(dLat[u]); lon[u] = (u ? lon[u - 1] : 0) + unzz(dLon[u]); }
  const rel = getVarints(sec('target'), m);
  const target = new Uint32Array(m);
  for (let u = 0; u < n; u++) for (let e = off[u]; e < off[u + 1]; e++) target[e] = u + unzz(rel[e]);
  const pLen = copyAs(Uint16Array, sec('len')), pCls = sec('cls'), pCi = copyAs(Uint32Array, sec('ci'));
  const exIdx = copyAs(Uint32Array, sec('ex_idx')), exLen = copyAs(Uint16Array, sec('ex_len')), exCls = sec('ex_cls'), exCi = copyAs(Uint32Array, sec('ex_ci'));
  if (exIdx.length !== ex) throw new Error('core graph: exception count');
  const lenDm = new Uint16Array(m), cls = new Uint8Array(m), ci = new Uint32Array(m);
  const part = partners(off, target, n);
  let p = 0, x = 0;
  for (let u = 0; u < n; u++) {
    for (let e = off[u]; e < off[u + 1]; e++) {
      if (u <= target[e]) { lenDm[e] = pLen[p]; cls[e] = pCls[p]; ci[e] = pCi[p]; p++; continue; }
      if (x < ex && exIdx[x] === e) { lenDm[e] = exLen[x]; cls[e] = exCls[x]; ci[e] = exCi[x]; x++; continue; }
      const f = part[e];
      if (f < 0) throw new Error('core graph: reverse edge without a partner');
      lenDm[e] = lenDm[f]; cls[e] = cls[f]; ci[e] = ci[f];
    }
  }
  if (p !== pLen.length || x !== ex) throw new Error('core graph: values left over');
  const { columns, ...rest } = h.base;
  const data: Record<string, Uint8Array> = { lat: bytesOf(lat), lon: bytesOf(lon), off: bytesOf(off), target: bytesOf(target), len_dm: bytesOf(lenDm), cls, ci: bytesOf(ci) };
  return writeContainer('BGR1', rest, columns.map((c) => ({ name: c.name, dtype: c.dtype, count: c.count, data: data[c.name] })));
}
