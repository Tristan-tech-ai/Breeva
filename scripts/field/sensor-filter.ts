/**
 * Rule S1 for implausible citizen-sensor readings of one hour (task F5-08, pre-registered in DECISIONS 16 Nov before
 * the test): drop a reading below 1 ug/m3, or one more than 5 times above or below the median of the 3 nearest other
 * sensors reporting that hour when that median is at least 5 ug/m3.
 */
import { distKm } from './kriging.js';

export interface Reading { lat: number; lon: number; pm25: number }

export const S1 = { floor: 1, factor: 5, neighbours: 3, minMedian: 5 } as const;

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : Number.NaN;
}

/** For each reading, true when rule S1 keeps it. */
export function s1Keep<T extends Reading>(rs: T[], p = S1): boolean[] {
  return rs.map((r, i) => {
    if (!(r.pm25 >= p.floor)) return false;
    const near = rs
      .map((o, j) => ({ j, d: j === i ? Infinity : distKm(r.lat, r.lon, o.lat, o.lon), v: o.pm25 }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, p.neighbours)
      .map((x) => x.v);
    if (near.length < p.neighbours) return true;
    const m = median(near);
    if (!(m >= p.minMedian)) return true;
    return r.pm25 <= p.factor * m && r.pm25 >= m / p.factor;
  });
}

export function s1Filter<T extends Reading>(rs: T[], p = S1): T[] {
  const keep = s1Keep(rs, p);
  return rs.filter((_, i) => keep[i]);
}
