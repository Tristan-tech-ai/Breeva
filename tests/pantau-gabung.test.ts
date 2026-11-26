import { describe, expect, it } from 'vitest';
import { gabungApi, radiusGabung, selGabung, teksGabung, ZOOM_GABUNG } from '../src/lib/nasional/petaPantau';
import { ringkasUkur } from '../src/lib/ukurHalaman';
import type { FirePoint } from '../src/lib/nasional/firms';

const api = (lon: number, lat: number, mw: number, k: string, dalam: boolean): FirePoint => [lon, lat, mw, k, '2026-11-26T05:00Z', 'VIIRS', dalam ? 'x' : undefined];

describe('M-U04 titik api digabung saat zoom jauh', () => {
  it('menggabung per sel 0,5 derajat dengan jumlah, daya, dan keyakinan', () => {
    const g = gabungApi([api(120.1, -3.1, 4, 'n', true), api(120.2, -3.2, 6, 'h', true), api(121.6, -3.1, 1, 'l', false)]);
    expect(g).toHaveLength(2);
    const a = g.find((x) => x.n === 2)!;
    expect(a.mw).toBe(10); expect(a.tinggi).toBe(true); expect(a.luar).toBe(false);
    expect(a.lon).toBeCloseTo(120.15); expect(a.lat).toBeCloseTo(-3.15);
    expect(g.find((x) => x.n === 1)!.luar).toBe(true);
  });
  it('radius layar terbatas 12 px', () => {
    expect(radiusGabung(1)).toBeCloseTo(4.2);
    expect(radiusGabung(10_000)).toBe(12);
    expect(ZOOM_GABUNG).toBe(7);
    expect(selGabung(4)).toBe(0.5); expect(selGabung(6)).toBe(0.25); expect(selGabung(7)).toBe(0.25); expect(selGabung(8)).toBeNull();
  });
  it('teks dalam bahasa Indonesia', () => {
    expect(teksGabung({ lat: 0, lon: 0, n: 12, mw: 1234.4, tinggi: false, luar: false })).toBe('12 titik api di sekitar sini (24 jam) · daya total 1.234 MW · perbesar untuk tiap titik');
  });
  it('ringkasan alat ukur halaman', () => {
    const h = ringkasUkur([16, 17, 16, 120, 18, 16, 16, 16, 17, 16], [60, 140], 300);
    expect(h).toEqual({ p95: 120, tugasMaks: 140, jank: 1, objek: 300, bingkai: 10 });
    expect(ringkasUkur([], [], 0).p95).toBe(0);
  });
});
