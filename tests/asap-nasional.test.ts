import { describe, expect, it } from 'vitest';
import { asapFile, gugusApi, jalurAsap } from '../src/lib/nasional/asap';
import { GRID, type WindFile } from '../src/lib/nasional/angin';
import { indexWilayah, type WilayahFC } from '../src/lib/nasional/wilayah';
import type { FirePoint } from '../src/lib/nasional/firms';

const n = GRID.nx * GRID.ny;
/** uniform wind for 24 hours: speed m/s, coming FROM `from` degrees */
const wind = (speed: number, from: number): WindFile => ({
  format: 'angin', updated_at: '', sumber: '', grid: GRID, hours: Array.from({ length: 24 }, (_, h) => `2026-11-25T${String(h).padStart(2, '0')}:00Z`),
  speed: Array.from({ length: n }, () => Array(24).fill(speed)), dir: Array.from({ length: n }, () => Array(24).fill(from)),
} as unknown as WindFile);
const fp = (lon: number, lat: number, frp: number, slug = 'kab-a'): FirePoint => [lon, lat, frp, 'h', '2026-11-25T05:00Z', 'N20', slug, 'ID-SS'];
const sq = (w: number, s: number, e: number, nn: number) => [[w, s], [e, s], [e, nn], [w, nn], [w, s]];
const fc: WilayahFC = { type: 'FeatureCollection', features: [
  { properties: { slug: 'kab-a', nama: 'Kabupaten A', provinsi: 'P', iso: 'ID-SS', pusat: [105, -3], luas_km2: 1 }, geometry: { type: 'Polygon', coordinates: [sq(104.8, -3.2, 105.2, -2.8)] } },
  { properties: { slug: 'kab-b', nama: 'Kabupaten B', provinsi: 'P', iso: 'ID-SS', pusat: [105.6, -3], luas_km2: 1 }, geometry: { type: 'Polygon', coordinates: [sq(105.2, -3.2, 106.4, -2.8)] } },
] };

describe('N-26 smoke paths from fire clusters', () => {
  it('joins points within 5 km into one cluster led by the strongest, strongest cluster first', () => {
    const g = gugusApi([fp(105, -3, 10), fp(105.02, -3, 30), fp(106, -3, 5, 'kab-b')]);
    expect(g).toHaveLength(2);
    expect(g[0].n).toBe(2);
    expect(g[0].frp).toBe(40);
    expect(g[0].lon).toBeCloseTo(105.015, 2); // weighted towards the 30 MW point
    expect(g[1].asal).toBe('kab-b');
  });
  it('moves with the wind: a 5 m/s wind from the west carries smoke 18 km east per hour', () => {
    const j = jalurAsap({ lon: 105, lat: -3 }, wind(5, 270), 0, 3);
    expect(j).toHaveLength(4);
    expect(j[1][0] - j[0][0]).toBeCloseTo(18 / (111.32 * Math.cos((3 * Math.PI) / 180)), 2);
    expect(Math.abs(j[3][1] - j[0][1])).toBeLessThan(1e-3);
  });
  it('names the kab/kota the path enters, not its own, with the first hour', () => {
    const a = asapFile([fp(105, -3, 20)], wind(5, 270), 0, indexWilayah(fc), new Date('2026-11-25T05:00:00Z'));
    expect(Object.keys(a.menuju)).toEqual(['kab-b']);
    expect(a.menuju['kab-b'][0]).toMatchObject({ gugus: 0, asal: 'kab-a' });
    expect(a.menuju['kab-b'][0].jam).toBe(2); // 105 -> 105.16 (hour 1, still A) -> 105.32 (hour 2, B)
    expect(a.catatan).toContain('perkiraan kasar');
  });
});
