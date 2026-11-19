import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextSchoolDay, rentangJam, saringTeks, saringUrut, spearman, tanggalDaftar, topOverlap, type DaftarPrioritas } from '../src/lib/prioritas';

const data = JSON.parse(readFileSync('public/data/prioritas/badung_denpasar.json', 'utf8')) as DaftarPrioritas;

describe('priority list data', () => {
  it('holds the 484 facilities of the proposal less courses and merged points, ranked by vehicle exhaust (F4-03, X-W88)', () => {
    expect(data.sumber_jumlah).toBe(484);
    const merged = (data.digabung ?? []).reduce((n, m) => n + m.digabung.length, 0);
    expect(data.jumlah).toBe(484 - (data.dikeluarkan?.length ?? 0) - merged);
    expect(data.fasilitas).toHaveLength(data.jumlah);
    expect(data.dikeluarkan?.map((d) => d.nama)).toContain('Primagama Buluh Indah Denpasar');
    expect(data.fasilitas.some((f) => /primagama|music school/i.test(f.nama ?? ''))).toBe(false);
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
    expect(sekolah.length + saringUrut(data.fasilitas, { kelas: 'kesehatan', cari: '', urutan: 'lalin' }).length).toBe(data.jumlah);
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

describe('banner of an indicative region (F1-27)', async () => {
  const { indicativeNote } = await import('../src/lib/prioritas');
  it('says what is indicative, the nearest-station evidence, and what still compares', () => {
    const n = indicativeNote('Kota Bogor');
    expect(n).toMatch(/^Indikatif: Kota Bogor belum punya titik ukur/);
    expect(n).toMatch(/Cibinong, Sentul City/);
    expect(n).toMatch(/tetap bisa dibandingkan/);
  });

  it('says which school day the list is for and how stable the order is between days (X-W89)', () => {
    const line = tanggalDaftar({ tanggal: '2026-11-21', zona: 'UTC+8', stabilitas: { banding_tanggal: '2026-11-18', fasilitas_sama: 471, spearman: 0.994, sepuluh_teratas_sama: 8 } });
    expect(line).toMatch(/^Contoh hari sekolah: Sabtu, 21 November 2026 \(UTC\+8\)/);
    expect(line).toContain('hampir tidak bergantung pada cuaca harian');
    expect(line).toContain('0,994 dan 8 dari 10 teratas sama');
    expect(tanggalDaftar({ tanggal: '2026-11-21', zona: 'UTC+7', stabilitas: { banding_tanggal: '2026-11-18', fasilitas_sama: 9, spearman: 0.5, sepuluh_teratas_sama: 2 } }))
      .toContain('ikut berubah dengan cuaca harian');
    expect(tanggalDaftar({ tanggal: '2026-11-21', zona: 'UTC+7' })).not.toMatch(/korelasi/);
    expect(data.stabilitas?.spearman).toBeGreaterThan(0.9);
  });

  it('the list is for the next Monday-Friday, never a weekend (X-W89)', () => {
    const day = (iso: string) => nextSchoolDay(new Date(iso)).toISOString().slice(0, 10);
    expect(day('2026-11-20T00:40:00Z')).toBe('2026-11-23'); // Friday night -> Monday
    expect(day('2026-11-18T21:00:00Z')).toBe('2026-11-19'); // Wednesday -> Thursday
    expect(day('2026-11-22T10:00:00Z')).toBe('2026-11-23'); // Sunday -> Monday
    expect(new Date(`${data.tanggal}T00:00:00Z`).getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(new Date(`${data.tanggal}T00:00:00Z`).getUTCDay()).toBeLessThanOrEqual(5);
  });

  it('rank statistics', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2], [1, 1, 2])).toBeCloseTo(1);
    expect(topOverlap(['a', 'b', 'c'], ['c', 'x', 'a'], 2)).toBe(0);
    expect(topOverlap(['a', 'b', 'c'], ['b', 'a', 'x'], 2)).toBe(2);
  });

  it('tells how the OpenStreetMap table became the list', () => {
    expect(saringTeks({ sumber_jumlah: 484, jumlah: 471, dikeluarkan: Array(7).fill({ id: '', nama: '', jenis: '', alasan: '' }),
      digabung: [{ tetap: 'a', nama: 'x', digabung: Array(6).fill({ id: '', nama: '', alasan: 'nama sama' }) }] }))
      .toBe('Dari 484 titik OpenStreetMap jadi 471 fasilitas: 7 tempat kursus, bimbel, dan perguruan tinggi tidak dihitung sebagai sekolah; 6 titik gerbang atau bangunan ganda digabung ke fasilitasnya.');
  });
});
