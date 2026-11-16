import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rentangJam, saringUrut, type DaftarPrioritas } from '../src/lib/prioritas';

const data = JSON.parse(readFileSync('public/data/prioritas/badung_denpasar.json', 'utf8')) as DaftarPrioritas;

describe('priority list data', () => {
  it('holds all 484 facilities of the proposal, ranked by the traffic-caused part', () => {
    expect(data.jumlah).toBe(484);
    expect(data.fasilitas).toHaveLength(484);
    expect(data.urutan).toBe('pm25_lalin');
    const lal = data.fasilitas.map((f) => f.pm25_lalin);
    expect(lal).toEqual([...lal].sort((a, b) => b - a));
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

  it('writes activity hours as a range', () => {
    expect(rentangJam([7, 8, 9, 10, 11, 12, 13])).toBe('07.00–14.00');
    expect(rentangJam(Array.from({ length: 24 }, (_, h) => h))).toBe('24 jam');
  });
});
