import { describe, expect, it } from 'vitest';
import { ROUTE_COLORS, routeCards } from '../src/lib/route/summary';

const r = (lengthM: number, timeS: number, no2Mean: number, pm25Mean: number) => ({ lengthM, timeS, no2Mean, pm25Mean, coords: [], w: 0 });

describe('walking route cards', () => {
  it('labels fastest and cleanest and compares each route with the fastest', () => {
    // the numbers of the first route test in Denpasar, 16 Nov (route worker, run 2026111610)
    const cards = routeCards([r(2283, 1756, 12.3, 26), r(2293, 1764, 10.1, 25.2), r(2371, 1824, 9.5, 26)]);
    expect(cards.map((c) => c.label)).toEqual(['Tercepat', 'Alternatif 1', 'Paling sedikit asap kendaraan']);
    expect(cards[0].color).toBe(ROUTE_COLORS.fastest);
    expect(cards[2].color).toBe(ROUTE_COLORS.cleanest);
    expect(cards[0].vsFastest).toBeNull();
    expect(cards[2].vsFastest).toEqual({ extraTimePct: 4, extraMin: 1, no2Pct: -23, exhDosePct: null });
    expect(cards[2].exh).toBeNull(); // a worker that does not report exhaust yet
    expect(cards[2].headline).toBe('Asap kendaraan: data belum tersedia untuk rute ini');
    expect(cards[0].km).toBe('2,28');
    expect(cards[0].minutes).toBe(29);
  });

  it('a single route is the fastest, and no routes give no cards', () => {
    expect(routeCards([r(500, 385, 8, 20)])[0].label).toBe('Tercepat');
    expect(routeCards([])).toEqual([]);
  });
});

describe('exhaust headline of a route card', () => {
  const x = (lengthM: number, timeS: number, exhMean: number) => ({ lengthM, timeS, no2Mean: 30 + exhMean, pm25Mean: 26, exhMean, coords: [], w: 0 });

  it('compares the dose (mean exhaust x time), so a longer route has to earn its detour', () => {
    // fastest: 20 minutes along a busy road; cleaner: 23 minutes through side streets
    const cards = routeCards([x(1600, 1200, 40), x(1840, 1380, 12)]);
    expect(cards[0].headline).toBe('Asap kendaraan rata-rata 40 µg/m³ (patokan)');
    expect(cards[1].vsFastest?.exhDosePct).toBe(Math.round(((12 * 1380) / (40 * 1200) - 1) * 100));
    expect(cards[1].headline).toBe('Asap kendaraan dihirup 65% lebih sedikit dari rute tercepat');
    expect(cards[1].vsFastest?.extraMin).toBe(3);
  });

  it('says so when the detour breathes more, and calls differences under 5% the same', () => {
    // lower mean but so much longer that the dose is higher
    expect(routeCards([x(1000, 800, 10), x(2000, 1600, 8)])[1].headline).toBe('Asap kendaraan dihirup 60% lebih banyak dari rute tercepat');
    expect(routeCards([x(1000, 800, 10), x(1010, 808, 10.2)])[1].headline).toBe('Asap kendaraan hampir sama dengan rute tercepat');
  });

  it('routes with practically no exhaust are not given a percentage', () => {
    const cards = routeCards([x(900, 700, 0.3), x(950, 740, 0.1)]);
    expect(cards[0].headline).toBe('Hampir tanpa asap kendaraan di sepanjang rute');
    expect(cards[1].headline).toBe('Hampir tanpa asap kendaraan, sama seperti rute tercepat');
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
