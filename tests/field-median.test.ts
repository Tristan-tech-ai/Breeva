import { describe, expect, it } from 'vitest';
import { fieldMedian, median } from '../src/lib/route/fieldMedian';

describe('field median kept per array (F3-20)', () => {
  it('is the same median as before: middle of the finite values, 1 when none', () => {
    expect(median(new Float64Array([5, NaN, 1, 3, Infinity]))).toBe(3);
    expect(median(new Float64Array([4, 2, 8, 6]))).toBe(6); // floor(n/2) of the sorted values, as the router used
    expect(median(new Float64Array([NaN]))).toBe(1);
  });
  it('computes once per array and gives the same number back', () => {
    const a = new Float64Array([9, 1, 5]);
    expect(fieldMedian(a)).toBe(median(a));
    a[0] = 100; // the cache is per array identity: the field arrays are never written after loading
    expect(fieldMedian(a)).toBe(5);
    expect(fieldMedian(new Float64Array([9, 1, 5]))).toBe(5);
  });
});
