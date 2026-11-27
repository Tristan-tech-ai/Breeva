import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { batasKeluar, garisPerjalanan, meterAntara, namaTujuan, nilaiKeluar, teksJarak, teksKm, TUJUAN_TANPA_NAMA } from '../src/lib/route/perjalanan';
import { deviceRouteAsRoute } from '../src/lib/route/appRoute';
import { getRouteColor } from '../src/components/map/mapColors';

// Tristan, 27 Nov 2026 (picture 09.26 WITA): during a walk a tap moved the destination pin while the line stayed on the
// old route; "Kamu keluar dari rute" showed at the start; the destination read "-8.6083, 115.1619".

describe('walk screen', () => {
  it('a tap during a walk does not change the destination (the store refuses it)', () => {
    const store = readFileSync('src/stores/mapStore.ts', 'utf8');
    const i = store.indexOf('setDestination: async');
    const set = store.slice(i, store.indexOf('clearDestination:', i));
    expect(set).toMatch(/useWalkStore\.getState\(\)\.isTracking/);
    expect(set.indexOf('isTracking')).toBeLessThan(set.indexOf('set({'));
    expect(set).not.toMatch(/toFixed\(4\)/); // no coordinates as a name
  });

  it('names a destination from the nearest place, or says it is a point on the map', () => {
    const pois = [{ name: 'Pura Desa Buduk', coordinate: { lat: -8.6083, lng: 115.1620 } }, { name: 'Warung Jauh', coordinate: { lat: -8.62, lng: 115.17 } }];
    expect(namaTujuan(pois, { lat: -8.6083, lng: 115.1619 })).toBe('Pura Desa Buduk'); // 11 m
    expect(namaTujuan(pois, { lat: -8.6090, lng: 115.1619 })).toBe('Dekat Pura Desa Buduk'); // about 78 m
    expect(namaTujuan(pois, { lat: -8.6110, lng: 115.1619 })).toBeNull(); // 300 m
    expect(namaTujuan([], { lat: 0, lng: 0 })).toBeNull();
    expect(TUJUAN_TANPA_NAMA).toBe('Titik di peta');
  });

  it('off the route only after two fixes beyond a limit that grows with the GPS error', () => {
    expect(batasKeluar(5)).toBe(30);
    expect(batasKeluar(40)).toBe(58);
    expect(batasKeluar(null)).toBe(30);
    let s = nilaiKeluar(35, 10, 0); // one fix off: not yet
    expect(s).toEqual({ beruntun: 1, keluar: false });
    s = nilaiKeluar(35, 10, s.beruntun);
    expect(s.keluar).toBe(true);
    expect(nilaiKeluar(35, 40, 5)).toEqual({ beruntun: 0, keluar: false }); // a coarse fix 35 m off is within its error
    expect(nilaiKeluar(10, 5, 3)).toEqual({ beruntun: 0, keluar: false }); // back on the line resets
  });

  it('the walked line starts at the walker and ends at the pin when they are near its ends', () => {
    const garis = [{ lat: -8.6118, lng: 115.1587 }, { lat: -8.6080, lng: 115.1600 }, { lat: -8.6044, lng: 115.1608 }];
    const awal = { lat: -8.6121, lng: 115.1588 }, pin = { lat: -8.6043, lng: 115.1610 };
    const g = garisPerjalanan(garis, awal, pin);
    expect(g[0]).toEqual(awal);
    expect(g[g.length - 1]).toEqual(pin);
    expect(g).toHaveLength(5);
    // a pin far from the route end (another place) is not joined
    expect(garisPerjalanan(garis, awal, { lat: -8.62, lng: 115.17 })).toHaveLength(4);
    expect(meterAntara(garis[0], garis[2])).toBeGreaterThan(800);
  });

  it('the line keeps the colour of the chosen card', () => {
    const r = deviceRouteAsRoute({ lengthM: 1000, timeS: 770, pm25Mean: 20, no2Mean: 10, exhMean: 1.5, coords: [[115.1587, -8.6118], [115.1608, -8.6044]], w: 0 },
      { id: 'x', userId: 'tamu', cleanest: false, avgAqi: 50, points: 10, warna: '#475569' });
    expect(getRouteColor(r)).toBe('#475569');
    expect(getRouteColor({ ...r, route_color: undefined })).toBe('#f59e0b'); // the old colours stay for server routes
  });

  it('numbers are written the Indonesian way', () => {
    expect(teksKm(0)).toBe('0,00');
    expect(teksKm(1234)).toBe('1,23');
    expect(teksJarak(1234)).toBe('1,2 km');
    expect(teksJarak(350.4)).toBe('350 m');
  });
});
