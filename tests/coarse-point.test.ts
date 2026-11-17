import { describe, expect, it } from 'vitest';
import { coarsePoint } from '../src/lib/coarsePoint';

describe('position sent for the air-quality card (F3-14)', () => {
  it('is rounded to two decimals, about 1.1 km', () => {
    expect(coarsePoint({ lat: -6.586912, lng: 106.794534 })).toEqual({ lat: -6.59, lng: 106.79 });
    const p = coarsePoint({ lat: -8.669781, lng: 115.215643 });
    expect(Math.abs(p.lat - -8.669781) * 110574).toBeLessThan(600);
    expect(String(p.lng).split('.')[1].length).toBeLessThanOrEqual(2);
  });
});
