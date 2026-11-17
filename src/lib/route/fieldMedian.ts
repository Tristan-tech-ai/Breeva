/**
 * Median of a field array (task F3-20). The walking cost normalises each road's NO2 by the region's median; sorting
 * 96 thousand values for every route request was three quarters of the routing time on a phone (CPU profile 18 Nov).
 * The value depends only on the array, so it is kept per array: the same number, computed once.
 */
export function median(a: Float64Array): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

const cache = new WeakMap<Float64Array, number>();

export function fieldMedian(a: Float64Array): number {
  let m = cache.get(a);
  if (m === undefined) {
    m = median(a);
    cache.set(a, m);
  }
  return m;
}
