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
  // edge shapes: absent in a core pack (F1-56, graphSplit.ts) until attachShapes(); edges are then drawn as straight
  // lines between their nodes
  private sh: Uint32Array;
  private shOff: Uint32Array;
  private shPts: Int32Array;
  private readonly scale: number;
  hasShapes: boolean;

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
    this.hasShapes = !!(cols.sh && cols.sh_off && cols.sh_pts);
    this.sh = (cols.sh as Uint32Array) ?? new Uint32Array(0);
    this.shOff = (cols.sh_off as Uint32Array) ?? new Uint32Array(0);
    this.shPts = (cols.sh_pts as Int32Array) ?? new Int32Array(0);
  }

  /** Adds the edge shapes of a core pack from its BSH1 file (graphSplit.ts). Throws when they do not belong to it. */
  attachShapes(bytes: Uint8Array): void {
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BSH1') throw new Error('not a BSH1 shapes file');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + dv.getUint32(4, true)))) as { m: number; region: string; geometry: string; columns: GraphColumn[] };
    if (head.m !== this.m || head.region !== this.meta.region || head.geometry !== this.meta.geometry) throw new Error('shapes belong to another graph');
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const cols: Record<string, Typed> = {};
    for (const c of head.columns) cols[c.name] = new CTOR[c.dtype](buf, c.offset, c.count);
    if (!cols.sh || !cols.sh_off || !cols.sh_pts || cols.sh.length !== this.m) throw new Error('shapes file is incomplete');
    this.sh = cols.sh as Uint32Array; this.shOff = cols.sh_off as Uint32Array; this.shPts = cols.sh_pts as Int32Array;
    this.hasShapes = true;
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
  /**
   * The points of edgeCoords(e, u), in the same order, as x = lon * mx and y = lat * my written into xs and ys without
   * allocating (F3-22: building a point array per edge was the slow part of finding the school of every edge). Returns
   * the point count, or minus that count when xs or ys is too short (nothing written).
   */
  edgeXY(e: number, u: number, mx: number, my: number, xs: Float64Array, ys: Float64Array): number {
    if (!this.hasShapes) {
      if (xs.length < 2 || ys.length < 2) return -2;
      const v = this.target[e];
      xs[0] = this.nodeLon(u) * mx; ys[0] = this.nodeLat(u) * my; xs[1] = this.nodeLon(v) * mx; ys[1] = this.nodeLat(v) * my;
      return 2;
    }
    const s = this.sh[e];
    const k = s >>> 1;
    const a = this.shOff[k], b = this.shOff[k + 1];
    const n = b - a + 2;
    if (xs.length < n || ys.length < n) return -n;
    xs[0] = this.nodeLon(u) * mx; ys[0] = this.nodeLat(u) * my;
    const rev = (s & 1) === 1;
    for (let j = 0; j < b - a; j++) {
      const q = rev ? b - 1 - j : a + j;
      xs[j + 1] = (this.shPts[2 * q] / this.scale) * mx;
      ys[j + 1] = (this.shPts[2 * q + 1] / this.scale) * my;
    }
    const v = this.target[e];
    xs[n - 1] = this.nodeLon(v) * mx; ys[n - 1] = this.nodeLat(v) * my;
    return n;
  }

  edgeCoords(e: number, u: number): Array<[number, number]> {
    const v0 = this.target[e];
    if (!this.hasShapes) return [[this.nodeLon(u), this.nodeLat(u)], [this.nodeLon(v0), this.nodeLat(v0)]];
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
