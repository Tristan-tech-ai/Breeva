import { describe, expect, it } from 'vitest';
import { ROUTE_COLORS, routeCards } from '../src/lib/route/summary';

const r = (lengthM: number, timeS: number, no2Mean: number, pm25Mean: number) => ({ lengthM, timeS, no2Mean, pm25Mean, coords: [], w: 0 });

describe('walking route cards', () => {
  it('labels fastest and cleanest and compares each route with the fastest', () => {
    // the numbers of the first route test in Denpasar, 16 Nov (route worker, run 2026111610)
    const cards = routeCards([r(2283, 1756, 12.3, 26), r(2293, 1764, 10.1, 25.2), r(2371, 1824, 9.5, 26)]);
    expect(cards.map((c) => c.label)).toEqual(['Tercepat', 'Alternatif 1', 'Terbersih (NO₂)']);
    expect(cards[0].color).toBe(ROUTE_COLORS.fastest);
    expect(cards[2].color).toBe(ROUTE_COLORS.cleanest);
    expect(cards[0].vsFastest).toBeNull();
    expect(cards[2].vsFastest).toEqual({ extraTimePct: 4, no2Pct: -23 });
    expect(cards[0].km).toBe('2,28');
    expect(cards[0].minutes).toBe(29);
  });

  it('a single route is the fastest, and no routes give no cards', () => {
    expect(routeCards([r(500, 385, 8, 20)])[0].label).toBe('Tercepat');
    expect(routeCards([])).toEqual([]);
  });
});

describe('motor route cards', () => {
  it('label the emergency and the two-number route and show the imposed exposure', () => {
    const cards = routeCards([
      { lengthM: 3000, timeS: 400, no2Mean: 30, pm25Mean: 26, coords: [], w: 0, kind: 'darurat', hargaMean: 1.61 },
      { lengthM: 3200, timeS: 430, no2Mean: 28, pm25Mean: 26, coords: [], w: 1, kind: 'dua-angka', hargaMean: 1.24 },
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Darurat: tercepat, tanpa poin', 'Dua angka (disarankan)']);
    expect(cards.map((c) => c.harga)).toEqual([1.61, 1.24]);
    expect(routeCards([r(500, 385, 8, 20)])[0].harga).toBeNull();
  });
});
