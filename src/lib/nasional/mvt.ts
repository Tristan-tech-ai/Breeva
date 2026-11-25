/**
 * N-21: a small Mapbox Vector Tile decoder for the national road tiles (tiles/jalan/2026-11, layer "jalan", properties
 * k = class code, o = one way, n = name). Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1 (protobuf
 * fields: Tile.layers = 3; Layer name 1, features 2, keys 3, values 4, extent 5; Feature id 1, tags 2, type 3,
 * geometry 4; geometry commands MoveTo 1, LineTo 2, ClosePath 7 with zigzag deltas). Only line strings are kept.
 */
export interface MvtLine { props: Record<string, string | number>; lines: Array<Array<[number, number]>> }

class Reader {
  pos = 0;
  readonly b: Uint8Array;
  end: number;
  constructor(b: Uint8Array) { this.b = b; this.end = b.length; }
  varint(): number {
    let r = 0, s = 0, x: number;
    do { x = this.b[this.pos++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80);
    return r;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
}

const utf8 = new TextDecoder();

function value(r: Reader, end: number): string | number {
  let v: string | number = '';
  while (r.pos < end) {
    const t = r.varint(), f = t >> 3, w = t & 7;
    if (f === 1 && w === 2) { const n = r.varint(); v = utf8.decode(r.b.subarray(r.pos, r.pos + n)); r.pos += n; }
    else if (f === 2 && w === 5) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; }
    else if (f === 3 && w === 1) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
    else if ((f === 4 || f === 5) && w === 0) v = r.varint();
    else if (f === 6 && w === 0) { const z = r.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; }
    else if (f === 7 && w === 0) v = r.varint();
    else r.skip(w);
  }
  return v;
}

/** Packed varints [pos, end). */
function packed(r: Reader): number[] {
  const n = r.varint(), end = r.pos + n, out: number[] = [];
  while (r.pos < end) out.push(r.varint());
  return out;
}

/** Line features of one layer, geometry converted to lon/lat for tile z/x/y. */
export function decodeLines(bytes: Uint8Array, layerName: string, z: number, x: number, y: number): MvtLine[] {
  const r = new Reader(bytes);
  const out: MvtLine[] = [];
  while (r.pos < r.end) {
    const t = r.varint();
    if (t >> 3 !== 3 || (t & 7) !== 2) { r.skip(t & 7); continue; }
    const len = r.varint(), lend = r.pos + len;
    let name = '', extent = 4096;
    const keys: string[] = [], vals: Array<string | number> = [];
    const feats: Array<{ tags: number[]; type: number; geom: number[] }> = [];
    while (r.pos < lend) {
      const tt = r.varint(), f = tt >> 3, w = tt & 7;
      if (f === 1 && w === 2) { const n = r.varint(); name = utf8.decode(bytes.subarray(r.pos, r.pos + n)); r.pos += n; }
      else if (f === 3 && w === 2) { const n = r.varint(); keys.push(utf8.decode(bytes.subarray(r.pos, r.pos + n))); r.pos += n; }
      else if (f === 4 && w === 2) { const n = r.varint(); const e = r.pos + n; vals.push(value(r, e)); r.pos = e; }
      else if (f === 5 && w === 0) extent = r.varint();
      else if (f === 2 && w === 2) {
        const n = r.varint(), fend = r.pos + n;
        const feat = { tags: [] as number[], type: 0, geom: [] as number[] };
        while (r.pos < fend) {
          const ft = r.varint(), ff = ft >> 3, fw = ft & 7;
          if (ff === 2 && fw === 2) feat.tags = packed(r);
          else if (ff === 3 && fw === 0) feat.type = r.varint();
          else if (ff === 4 && fw === 2) feat.geom = packed(r);
          else r.skip(fw);
        }
        r.pos = fend;
        feats.push(feat);
      } else r.skip(w);
    }
    r.pos = lend;
    if (name !== layerName) continue;
    const size = extent * 2 ** z;
    const toLonLat = (px: number, py: number): [number, number] => {
      const gx = (x * extent + px) / size, gy = (y * extent + py) / size;
      return [gx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * gy))) * 180) / Math.PI];
    };
    for (const f of feats) {
      if (f.type !== 2) continue;
      const props: Record<string, string | number> = {};
      for (let i = 0; i + 1 < f.tags.length; i += 2) props[keys[f.tags[i]]] = vals[f.tags[i + 1]];
      const lines: Array<Array<[number, number]>> = [];
      let cx = 0, cy = 0, i = 0, cur: Array<[number, number]> = [];
      while (i < f.geom.length) {
        const c = f.geom[i++], cmd = c & 7, cnt = c >> 3;
        if (cmd === 7) continue;
        for (let k = 0; k < cnt; k++) {
          const dx = f.geom[i++], dy = f.geom[i++];
          cx += dx % 2 ? -(dx + 1) / 2 : dx / 2;
          cy += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (cmd === 1) { if (cur.length > 1) lines.push(cur); cur = [toLonLat(cx, cy)]; }
          else cur.push(toLonLat(cx, cy));
        }
      }
      if (cur.length > 1) lines.push(cur);
      if (lines.length) out.push({ props, lines });
    }
  }
  return out;
}

/** Tile x/y of a lon/lat at zoom z. */
export function tileOf(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)];
}
