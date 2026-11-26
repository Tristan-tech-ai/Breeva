import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// M-A03 and M-C01: the data files behind the two new /validasi sections are well formed and consistent.
const baca = (f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));

describe('validasi_kerapatan.json (M-A03)', () => {
  const d = baca('validasi_kerapatan.json');
  it('has a density curve with growing sensor counts and EPA passes between 0 and 4', () => {
    const ns = d.kurva.map((k: { n: number }) => k.n);
    expect(ns.length).toBeGreaterThanOrEqual(5);
    expect([...ns].sort((a: number, b: number) => a - b)).toEqual(ns);
    for (const k of d.kurva) {
      expect(k.lolos_median).toBeGreaterThanOrEqual(0);
      expect(k.lolos_median).toBeLessThanOrEqual(4);
      expect(k.lolos_p25_p75[0]).toBeLessThanOrEqual(k.lolos_p25_p75[1]);
    }
  });
  it('names the count for 4 of 4 only when the curve reaches it', () => {
    const capai = d.kurva.find((k: { lolos_median: number }) => k.lolos_median >= 4);
    expect(d.n_untuk_4_dari_4).toBe(capai ? capai.n : null);
  });
  it('counts every sensor once across the location classes', () => {
    const total = Object.values(d.kelas as Record<string, { n: number }>).reduce((s, k) => s + k.n, 0);
    expect(total).toBeLessThanOrEqual(d.sensor);
    expect(total).toBeGreaterThan(0);
  });
});

describe('validasi_pola_jam.json (M-C01)', () => {
  const d = baca('validasi_pola_jam.json');
  it('keeps correlations in [-1, 1] and used cameras within the camera count', () => {
    for (const k of Object.values(d.kota as Record<string, { kamera: number; dipakai: number; rho_median: number | null; rho_kuartil: [number, number] | null; bagian_rho_0_5: number | null }>)) {
      expect(k.dipakai).toBeLessThanOrEqual(k.kamera);
      if (k.rho_median != null) {
        expect(Math.abs(k.rho_median)).toBeLessThanOrEqual(1);
        expect(k.rho_kuartil![0]).toBeLessThanOrEqual(k.rho_median);
        expect(k.rho_median).toBeLessThanOrEqual(k.rho_kuartil![1]);
        expect(k.bagian_rho_0_5).toBeGreaterThanOrEqual(0);
        expect(k.bagian_rho_0_5).toBeLessThanOrEqual(1);
      }
    }
  });
  it('says it is a traffic-pattern check, not map accuracy', () => {
    expect(d.catatan).toMatch(/bukan akurasi kadar/);
    expect(d.catatan).toMatch(/tidak masuk angka peta/);
  });
});
