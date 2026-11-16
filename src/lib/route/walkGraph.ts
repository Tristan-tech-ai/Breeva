/**
 * Reader for the walking graph pack (BGR1) written by vayu/field/graph.py; layout described there and in
 * LAMPIRAN_TEKNIS L5.1. Runs in the browser and in Node (tests, scripts).
 */

export interface GraphColumn { name: string; dtype: string; offset: number; count: number }
export interface GraphMeta {
  format: 'BGR1'; geometry: string; region: string; name: string; bbox: [number, number, number, number];
  n: number; m: number; shapes: number; coord_scale: number; cls_codes: string[];
  flags: { steps: number; footway: number; crossing: number }; ci_none: number; max_edge_m: number;
  stats?: Record<string, unknown>; columns: GraphColumn[];
}

type Typed = Uint8Array | Uint16Array | Uint32Array | Int32Array;
const CTOR: Record<string, new (b: ArrayBuffer, o: number, n: number) => Typed> = {
  '<u1': Uint8Array, '<u2': Uint16Array, '<u4': Uint32Array, '<i4': Int32Array,
};

export class WalkGraph {
  readonly meta: GraphMeta;
  readonly n: number;
  readonly m: number;
  readonly lat: Int32Array;
  readonly lon: Int32Array;
  readonly off: Uint32Array;
  readonly target: Uint32Array;
  readonly lenDm: Uint16Array;
  readonly cls: Uint8Array;
  readonly ci: Uint32Array;
  private readonly sh: Uint32Array;
  private readonly shOff: Uint32Array;
  private readonly shPts: Int32Array;
  private readonly scale: number;

  constructor(bytes: Uint8Array) {
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BGR1') throw new Error('not a BGR1 graph');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hl = dv.getUint32(4, true);
    this.meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as GraphMeta;
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const cols: Record<string, Typed> = {};
    for (const c of this.meta.columns) {
      const C = CTOR[c.dtype];
      if (!C) throw new Error(`unsupported dtype ${c.dtype}`);
      cols[c.name] = new C(buf, c.offset, c.count);
    }
    this.n = this.meta.n; this.m = this.meta.m; this.scale = this.meta.coord_scale;
    this.lat = cols.lat as Int32Array; this.lon = cols.lon as Int32Array;
    this.off = cols.off as Uint32Array; this.target = cols.target as Uint32Array;
    this.lenDm = cols.len_dm as Uint16Array; this.cls = cols.cls as Uint8Array; this.ci = cols.ci as Uint32Array;
    this.sh = cols.sh as Uint32Array; this.shOff = cols.sh_off as Uint32Array; this.shPts = cols.sh_pts as Int32Array;
  }

  nodeLat(u: number): number { return this.lat[u] / this.scale; }
  nodeLon(u: number): number { return this.lon[u] / this.scale; }

  /** Highway class of a directed edge. */
  highway(e: number): string { return this.meta.cls_codes[this.cls[e] & 31] ?? 'other'; }
  isSteps(e: number): boolean { return (this.cls[e] & this.meta.flags.steps) !== 0; }
  isFootway(e: number): boolean { return (this.cls[e] & this.meta.flags.footway) !== 0; }

  /** Road-pack cell and index the edge runs along, or null. */
  road(e: number): { c: number; i: number } | null {
    const v = this.ci[e];
    if (v === this.meta.ci_none) return null;
    return { c: v >>> 20, i: v & 0xfffff };
  }

  /** Polyline of directed edge e, which leaves node u, as [lon, lat] pairs with both end nodes. */
  edgeCoords(e: number, u: number): Array<[number, number]> {
    const s = this.sh[e];
    const k = s >>> 1;
    const a = this.shOff[k], b = this.shOff[k + 1];
    const inner: Array<[number, number]> = [];
    for (let q = a; q < b; q++) inner.push([this.shPts[2 * q] / this.scale, this.shPts[2 * q + 1] / this.scale]);
    if (s & 1) inner.reverse();
    const v = this.target[e];
    return [[this.nodeLon(u), this.nodeLat(u)], ...inner, [this.nodeLon(v), this.nodeLat(v)]];
  }
}
