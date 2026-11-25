import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sebaranJarak } from '../src/lib/prioritasViz';
import { saringUrut, type DaftarPrioritas } from '../src/lib/prioritas';

const load = (n: string) => JSON.parse(readFileSync(`public/data/prioritas/${n}.json`, 'utf8')) as DaftarPrioritas;

describe('N-06 /prioritas charts', () => {
  it('the lists keep 471 and 1.493 facilities, and every facility falls in one distance band', () => {
    for (const [name, n] of [['badung_denpasar', 471], ['kota_bogor', 1493]] as const) {
      const d = load(name);
      expect(d.jumlah).toBe(n);
      expect(d.fasilitas).toHaveLength(n);
      expect(sebaranJarak(d.fasilitas).reduce((a, b) => a + b.n, 0)).toBe(n);
    }
  });
  it('the top-10 bars are the first ten of the list ranked by exhaust', () => {
    const d = load('kota_bogor');
    const top = saringUrut(d.fasilitas, { kelas: 'semua', cari: '', urutan: 'lalin' }).slice(0, 10);
    expect(top).toHaveLength(10);
    for (let k = 1; k < top.length; k++) expect(top[k - 1].no2_lalin).toBeGreaterThanOrEqual(top[k].no2_lalin);
  });
  it('bands are nearest first and cover 0 m to beyond 500 m', () => {
    expect(sebaranJarak([{ d_ramai_m: 0 }, { d_ramai_m: 49 }, { d_ramai_m: 50 }, { d_ramai_m: 499 }, { d_ramai_m: 5000 }]).map((b) => b.n)).toEqual([2, 1, 0, 1, 1]);
  });
});
