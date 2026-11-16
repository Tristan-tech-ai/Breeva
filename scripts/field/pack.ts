/**
 * Reader for road packs (BRP1) written by vayu/field/pack.py. See that file for the layout and the ordering rules.
 */

export interface PackColumn { name: string; dtype: string; offset: number; count: number }
export interface PackMeta {
  format: 'BRP1'; geometry: string; region: string; bbox: [number, number, number, number]; n: number;
  cells: Array<[number, number]>; cell_zoom: number; hilbert_order: number; coord_scale: number;
  highway_codes: string[]; strings: Record<string, string[]>;
  neighbours: { cell_deg: number; cutoff_m: number; cap: number };
  columns: PackColumn[];
}

type Typed = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

const CTOR: Record<string, new (b: ArrayBuffer, o: number, n: number) => Typed> = {
  '<u1': Uint8Array, '<u2': Uint16Array, '<u4': Uint32Array, '<i4': Int32Array, '<f4': Float32Array, '<f8': Float64Array,
};

export class RoadPack {
  readonly meta: PackMeta;
  readonly n: number;
  private readonly cols: Record<string, Typed> = {};

  constructor(bytes: Uint8Array) {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== 'BRP1') throw new Error('not a BRP1 pack');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hl = dv.getUint32(4, true);
    this.meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as PackMeta;
    this.n = this.meta.n;
    // Copy into an aligned buffer so typed views can start at the column offsets (all multiples of 8).
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    for (const c of this.meta.columns) {
      const C = CTOR[c.dtype];
      if (!C) throw new Error(`unsupported dtype ${c.dtype}`);
      this.cols[c.name] = new C(buf, c.offset, c.count);
    }
  }

  col<T extends Typed = Typed>(name: string): T {
    const c = this.cols[name];
    if (!c) throw new Error(`no column ${name}`);
    return c as T;
  }

  num(name: string, k: number): number | null {
    const v = this.col(name)[k];
    return Number.isNaN(v) ? null : v;
  }

  str(name: string, k: number): string | null {
    const s = this.meta.strings[name][this.col(name)[k]];
    return s === '' ? null : s;
  }

  highway(k: number): string {
    return this.meta.highway_codes[this.col('hw')[k]];
  }

  /** [lon, lat] pairs. */
  coords(k: number): number[][] {
    const off = this.col<Uint32Array>('coord_off');
    const xy = this.col<Int32Array>('coords');
    const s = this.meta.coord_scale;
    const out: number[][] = [];
    for (let p = off[k]; p < off[k + 1]; p++) out.push([xy[2 * p] / s, xy[2 * p + 1] / s]);
    return out;
  }

  neighbours(k: number): Uint32Array {
    const off = this.col<Uint32Array>('nb_off');
    return this.col<Uint32Array>('nb').subarray(off[k], off[k + 1]);
  }

  /** Road index -> (c, i) identity of L1.1. */
  id(k: number): { c: number; i: number } {
    return { c: this.col('c')[k], i: this.col('i')[k] };
  }
}
