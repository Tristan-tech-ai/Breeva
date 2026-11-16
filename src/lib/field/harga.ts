/**
 * Harga hirup per road (BHI1, written by vayu/field/harga_hirup.py write_client): how much breathing the exhaust of a
 * road reaches, as an index (1 = the region's median road). Read by the map; the routing cost uses the same file.
 */

export interface HargaMeta {
  format: 'BHI1'; geometry: string; name: string; n: number; step: number;
  /** Road (c, i) is at cell_offsets[c] + i in the data. */
  cell_offsets: number[];
  /** Edges of the five fixed classes (20 % of the region's roads each). */
  quintiles: [number, number, number, number];
  median_h_iso?: number;
}

export class HargaIndex {
  readonly meta: HargaMeta;
  private readonly data: Uint16Array;

  constructor(bytes: Uint8Array) {
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BHI1') throw new Error('not a BHI1 file');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const hl = dv.getUint32(4, true);
    this.meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as HargaMeta;
    const start = Math.ceil((8 + hl) / 8) * 8;
    const buf = new ArrayBuffer(this.meta.n * 2);
    new Uint8Array(buf).set(bytes.subarray(start, start + this.meta.n * 2));
    this.data = new Uint16Array(buf);
  }

  /** Index of road (c, i), or null when the road is not in the file. */
  value(c: number, i: number): number | null {
    const o = this.meta.cell_offsets;
    if (c < 0 || c + 1 >= o.length || i < 0 || o[c] + i >= o[c + 1]) return null;
    return this.data[o[c] + i] * this.meta.step;
  }

  /** Class 0 (lowest fifth of the region's roads) .. 4 (highest fifth). */
  klass(h: number): number {
    let k = 0;
    for (const q of this.meta.quintiles) if (h > q) k++;
    return k;
  }
}

/** Teal ramp, distinct from the ISPU colours and the violet traffic view. */
export const HARGA_COLORS = ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a'] as const;
export const HARGA_LABELS = ['20% terendah', 'rendah', 'tengah', 'tinggi', '20% tertinggi'] as const;
