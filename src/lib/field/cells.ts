/**
 * Value cells (BVF1, LAMPIRAN_TEKNIS L1.3): one file per z12 cell and run, values in the pack's (c, i) order.
 *
 *   0      4    magic "BVF1"
 *   4      4    n (uint32 LE)
 *   8      2    column bitmask (bit0 pm25, bit1 pm25 delta, bit2 no2, bit3 no2 delta, bit4 flags)
 *   10     2    scale: 0 = the three byte columns are linear; 1 = long tail (linear to code 200, then geometric to
 *               code 255: pm25 delta 10..200, no2 200..1000, no2 delta 50..1000), added 16 Nov 2026 because busy
 *               roads passed the linear tops
 *   12     n*2  pm25 total, uint16, 0.1 ug/m3
 *   ...    n    pm25 traffic delta, uint8, 0.05 ug/m3 (saturates at 12.75)
 *   ...    n    no2 total, uint8, 1 ug/m3 (saturates at 255)
 *   ...    n    no2 delta, uint8, 0.25 ug/m3 (saturates at 63.75)
 *   ...    n    flags: bit0-1 confidence (0 low/refuse .. 3 high), bit2 OOD, bit3-7 PI95 half-width code (step 2 ug/m3)
 */

export const STEP = { pm25: 0.1, pm25_delta: 0.05, no2: 1, no2_delta: 0.25, pi_half: 2 } as const;
const MAXQ = { pm25: 65535, pm25_delta: 255, no2: 255, no2_delta: 255, pi_half: 31 } as const;
export const ALL_COLUMNS = 0b11111;

export type Confidence = 'high' | 'medium' | 'low' | 'refuse';
const CONF_CODE: Record<Confidence, number> = { refuse: 0, low: 1, medium: 2, high: 3 };
const CODE_CONF: Confidence[] = ['refuse', 'low', 'medium', 'high'];

export interface CellValue {
  pm25: number; pm25_delta: number; no2: number; no2_delta: number;
  confidence: Confidence; ood: boolean; pi_half: number;
}

function q(x: number, step: number, max: number): number {
  if (!Number.isFinite(x)) throw new Error(`non-finite value ${x}`);
  return Math.min(max, Math.max(0, Math.round(x / step)));
}

type TailColumn = 'pm25_delta' | 'no2' | 'no2_delta';
const KNEE = 200, TOP = 255;
/** Largest value each byte column holds on the long-tail scale. */
export const TAIL_MAX: Record<TailColumn, number> = { pm25_delta: 200, no2: 1000, no2_delta: 1000 };

function qTail(x: number, col: TailColumn): number {
  if (!Number.isFinite(x)) throw new Error(`non-finite value ${x}`);
  const knee = KNEE * STEP[col];
  if (x <= knee) return Math.max(0, Math.round(x / STEP[col]));
  return Math.min(TOP, KNEE + Math.round(((TOP - KNEE) * Math.log(x / knee)) / Math.log(TAIL_MAX[col] / knee)));
}
function dTail(code: number, col: TailColumn): number {
  const knee = KNEE * STEP[col];
  return code <= KNEE ? code * STEP[col] : knee * Math.pow(TAIL_MAX[col] / knee, (code - KNEE) / (TOP - KNEE));
}

/** One value of a byte column on the long-tail scale (used by the exhaust forecast files as well). */
export const encodeTailByte = (x: number, col: TailColumn) => qTail(x, col);
export const decodeTailByte = (code: number, col: TailColumn) => dTail(code, col);

/** scale 'tail' keeps values above the linear tops (see the header); 'linear' is the format of runs before it. */
export function encodeCell(values: CellValue[], scale: 'linear' | 'tail' = 'linear'): Uint8Array {
  const n = values.length;
  const buf = new Uint8Array(12 + n * 2 + n * 4);
  const dv = new DataView(buf.buffer);
  buf.set([0x42, 0x56, 0x46, 0x31], 0); // "BVF1"
  dv.setUint32(4, n, true);
  dv.setUint16(8, ALL_COLUMNS, true);
  const tail = scale === 'tail';
  dv.setUint16(10, tail ? 1 : 0, true);
  const enc = (x: number, col: TailColumn) => (tail ? qTail(x, col) : q(x, STEP[col], MAXQ[col]));
  let o = 12;
  for (const v of values) { dv.setUint16(o, q(v.pm25, STEP.pm25, MAXQ.pm25), true); o += 2; }
  for (const v of values) buf[o++] = enc(v.pm25_delta, 'pm25_delta');
  for (const v of values) buf[o++] = enc(v.no2, 'no2');
  for (const v of values) buf[o++] = enc(v.no2_delta, 'no2_delta');
  for (const v of values) {
    buf[o++] = CONF_CODE[v.confidence] | (v.ood ? 4 : 0) | (q(v.pi_half, STEP.pi_half, MAXQ.pi_half) << 3);
  }
  return buf;
}

export function decodeCell(bytes: Uint8Array): CellValue[] {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BVF1') throw new Error('not a BVF1 cell');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(4, true);
  if (dv.getUint16(8, true) !== ALL_COLUMNS) throw new Error('unsupported column mask');
  if (bytes.byteLength !== 12 + n * 6) throw new Error(`size ${bytes.byteLength} does not match n=${n}`);
  const scale = dv.getUint16(10, true);
  if (scale > 1) throw new Error(`unsupported scale ${scale}`);
  const dec = (code: number, col: TailColumn) => (scale === 1 ? dTail(code, col) : code * STEP[col]);
  const pmO = 12, dO = pmO + 2 * n, noO = dO + n, ndO = noO + n, fO = ndO + n;
  const out: CellValue[] = [];
  for (let k = 0; k < n; k++) {
    const f = bytes[fO + k];
    out.push({
      pm25: dv.getUint16(pmO + 2 * k, true) * STEP.pm25,
      pm25_delta: dec(bytes[dO + k], 'pm25_delta'),
      no2: dec(bytes[noO + k], 'no2'),
      no2_delta: dec(bytes[ndO + k], 'no2_delta'),
      confidence: CODE_CONF[f & 3], ood: (f & 4) !== 0, pi_half: (f >> 3) * STEP.pi_half,
    });
  }
  return out;
}

/** True when a value is at the top of its range, i.e. the stored number is a floor, not the value. */
export function saturated(col: 'pm25_delta' | 'no2' | 'no2_delta' | 'pi_half', x: number, scale: 'linear' | 'tail' = 'linear'): boolean {
  if (scale === 'tail' && col !== 'pi_half') return x >= TAIL_MAX[col];
  return Math.round(x / STEP[col]) >= MAXQ[col];
}
