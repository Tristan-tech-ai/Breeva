/**
 * Exhaust forecast for departure times (task F3-10): which hours ahead the builder computes, the file holding one
 * hour's exhaust per road (BXF1), and which forecast a departure time uses. Pure, shared by the builder and the
 * route worker.
 *
 * BXF1, one file per region, run and forecast hour, roads grouped by z12 cell in the order of the value cells:
 *   0      4        magic "BXF1"
 *   4      2        number of cells k
 *   6      2        reserved (0)
 *   8      6k       per cell: c (uint16 LE), count (uint32 LE)
 *   8+6k   sum(n)   traffic NOx per road, one byte on the long-tail scale of the value cells (column no2_delta)
 */
import { decodeTailByte, encodeTailByte } from './cells';

/** Local hours the school trips start at: 06.45 rounds to 07, 12.30 to 13 (see departHour). */
export const SCHOOL_TRIP_HOURS = [7, 13] as const;
/** Hours ahead always computed, for the "berangkat lebih awal atau nanti" suggestion. */
export const SOON_HOURS = 3;

/**
 * Offsets (hours after the run's valid hour, 1..24) the builder computes: the next SOON_HOURS hours and the next
 * occurrence of each school trip hour. Sorted, without repeats.
 */
export function forecastOffsets(hourLocalNow: number, tripHours: readonly number[] = SCHOOL_TRIP_HOURS, soon = SOON_HOURS): number[] {
  const set = new Set<number>();
  for (let h = 1; h <= soon; h++) set.add(h);
  for (const t of tripHours) set.add(((t - hourLocalNow + 23) % 24) + 1); // 1..24, never 0 (that is the run itself)
  return [...set].sort((a, b) => a - b);
}

/** Local hour a departure "HH:MM" is judged by: the nearest whole hour (06.45 -> 7, 12.30 -> 13). */
export function departHour(hhmm: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Math.round((Number(m[1]) * 60 + Number(m[2])) / 60) % 24;
}

export interface ForecastEntry { ahead: number; valid: string; local_hour: number; key: string }

/**
 * Forecast a departure uses: the entry for its local hour, or null when the departure is now (or rounds to the run's
 * own hour) or no forecast covers it.
 */
export function pickForecast(entries: readonly ForecastEntry[], departLocal: string | null | undefined, runLocalHour: number): ForecastEntry | null {
  if (!departLocal) return null;
  const h = departHour(departLocal);
  if (h == null || h === runLocalHour) return null;
  return entries.find((e) => e.local_hour === h) ?? null;
}

export function encodeExhaust(byCell: Array<{ c: number; values: ArrayLike<number> }>): Uint8Array {
  const total = byCell.reduce((s, x) => s + x.values.length, 0);
  const buf = new Uint8Array(8 + 6 * byCell.length + total);
  const dv = new DataView(buf.buffer);
  buf.set([0x42, 0x58, 0x46, 0x31], 0); // "BXF1"
  dv.setUint16(4, byCell.length, true);
  let o = 8;
  for (const { c, values } of byCell) { dv.setUint16(o, c, true); dv.setUint32(o + 2, values.length, true); o += 6; }
  for (const { values } of byCell) for (let i = 0; i < values.length; i++) buf[o++] = encodeTailByte(values[i], 'no2_delta');
  return buf;
}

/** Map from cell to that cell's exhaust values, in the order of the value cell. */
export function decodeExhaust(bytes: Uint8Array): Map<number, Float32Array> {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'BXF1') throw new Error('not a BXF1 file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const k = dv.getUint16(4, true);
  let o = 8 + 6 * k;
  const out = new Map<number, Float32Array>();
  for (let j = 0; j < k; j++) {
    const c = dv.getUint16(8 + 6 * j, true), n = dv.getUint32(10 + 6 * j, true);
    if (o + n > bytes.byteLength) throw new Error('BXF1 file is truncated');
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = decodeTailByte(bytes[o + i], 'no2_delta');
    out.set(c, v);
    o += n;
  }
  if (o !== bytes.byteLength) throw new Error('BXF1 size does not match its cells');
  return out;
}
