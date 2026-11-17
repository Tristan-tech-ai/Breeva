import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rentangJam, saringUrut, type DaftarPrioritas } from '../src/lib/prioritas';

const data = JSON.parse(readFileSync('public/data/prioritas/badung_denpasar.json', 'utf8')) as DaftarPrioritas;

describe('priority list data', () => {
  it('holds all 484 facilities of the proposal, ranked by vehicle exhaust (F4-03)', () => {
    expect(data.jumlah).toBe(484);
    expect(data.fasilitas).toHaveLength(484);
    expect(data.urutan).toBe('asap_kendaraan');
    expect(data.mesin).toMatch(/iso1/);
    const asap = data.fasilitas.map((f) => f.no2_lalin);
    expect(asap).toEqual([...asap].sort((a, b) => b - a));
    expect(data.fasilitas.map((f) => f.peringkat)).toEqual(data.fasilitas.map((_, k) => k + 1));
  });

  it('every value is physical: totals at least the traffic part plus background', () => {
    for (const f of data.fasilitas) {
      expect(f.pm25_lalin).toBeGreaterThanOrEqual(0);
      expect(f.pm25).toBeGreaterThan(0);
      expect(Math.abs(f.pm25 - (f.pm25_latar + f.pm25_lalin))).toBeLessThan(0.11);
      expect(f.jam.length).toBeGreaterThan(0);
    }
  });

  it('filters by class and name, and sorts on request', () => {
    const sekolah = saringUrut(data.fasilitas, { kelas: 'pendidikan', cari: '', urutan: 'lalin' });
    expect(sekolah.every((f) => f.kelas === 'pendidikan')).toBe(true);
    expect(sekolah.length + saringUrut(data.fasilitas, { kelas: 'kesehatan', cari: '', urutan: 'lalin' }).length).toBe(484);
    const sd = saringUrut(data.fasilitas, { kelas: 'semua', cari: 'sd negeri', urutan: 'nama' });
    expect(sd.length).toBeGreaterThan(0);
    expect(sd.every((f) => f.nama.toLowerCase().includes('sd negeri'))).toBe(true);
    const byDist = saringUrut(data.fasilitas, { kelas: 'semua', cari: '', urutan: 'jarak' });
    expect(byDist[0].d_ramai_m).toBeLessThanOrEqual(byDist[byDist.length - 1].d_ramai_m);
  });

  it('facilities at a major road breathe more exhaust than those far from one, and the summary follows the list', () => {
    const med = (x: number[]) => { const t = [...x].sort((m, n) => m - n); return t[Math.floor(t.length / 2)]; };
    const near = data.fasilitas.filter((f) => f.d_major_m <= 20).map((f) => f.no2_lalin);
    const far = data.fasilitas.filter((f) => f.d_major_m > 300).map((f) => f.no2_lalin);
    expect(near.length).toBeGreaterThan(10);
    expect(far.length).toBeGreaterThan(10);
    expect(med(near)).toBeGreaterThan(2 * med(far));
    const all = data.fasilitas.map((f) => f.no2_lalin);
    expect(Math.abs(data.ringkasan.asap_median! - med(all))).toBeLessThan(0.11);
    expect(data.ringkasan.asap_p90!).toBeGreaterThan(data.ringkasan.asap_median!);
  });

  it('the default sort is by exhaust, PM2,5 from traffic breaking ties', () => {
    const a = { ...data.fasilitas[0], no2_lalin: 5, pm25_lalin: 0.1 }, b = { ...data.fasilitas[1], no2_lalin: 9, pm25_lalin: 0.05 };
    const c = { ...data.fasilitas[2], no2_lalin: 5, pm25_lalin: 0.3 };
    expect(saringUrut([a, b, c], { kelas: 'semua', cari: '', urutan: 'lalin' }).map((f) => f.no2_lalin * 10 + f.pm25_lalin))
      .toEqual([90.05, 50.3, 50.1]);
  });

  it('writes activity hours as a range', () => {
    expect(rentangJam([7, 8, 9, 10, 11, 12, 13])).toBe('07.00–14.00');
    expect(rentangJam(Array.from({ length: 24 }, (_, h) => h))).toBe('24 jam');
  });
});
