import { describe, expect, it } from 'vitest';
import { bukaKartu, kartuRuas, kartuTerbuka, kategoriAsap, saranJam, tutupKartu, KARTU_BUKA, KARTU_TUTUP } from '../src/lib/field/kartu';
import type { CellValue } from '../src/lib/field/cells';

const v = { pm25: 16.2, pm25_delta: 0.5, no2: 30, no2_delta: 7.3, confidence: 'high', ood: false, pi_half: 28 } as unknown as CellValue;
const src = {
  ageHours: () => 5 / 60, isStale: () => false,
  manifest: { indicative: false, measurement: { method: 'kriging' } },
  harga: { value: () => 1.2, klass: () => 3 },
} as never;

describe('kartu ruas', () => {
  it('mode asap kendaraan: angka utama NO2 dari knalpot dengan kata biasa, format Indonesia', () => {
    const k = kartuRuas(v, 'Cok Agung Tresna', src, 1, 2, 'aqi', 'traffic');
    expect(k.judul).toBe('Cok Agung Tresna');
    expect(k.utama).toBe('7,3 µg/m³');
    expect(k.kategori).toBe('asap kendaraan · sedang');
    expect(k.rincian.join(' ')).toContain('rentang 95%');
    expect(k.rincian.join(' ')).toContain('Harga hirup 1,2× median wilayah (tinggi)');
    expect(k.rincian.join(' ')).toContain('belum diuji di pinggir jalan');
    expect(k.rincian.join(' ')).not.toMatch(/\d\.\d/); // no dot decimals
  });
  it('mode udara total mengikuti jenis polusi: ISPU, PM2,5, NO2', () => {
    expect(kartuRuas(v, 'X', src, 1, 2, 'aqi', 'total').utama).toBe('ISPU 51');
    expect(kartuRuas(v, 'X', src, 1, 2, 'aqi', 'total').kategori).toBe('udara total · Sedang');
    expect(kartuRuas(v, 'X', src, 1, 2, 'pm25', 'total').utama).toBe('16,2 µg/m³');
    expect(kartuRuas(v, 'X', src, 1, 2, 'pm25', 'total').kategori).toBe('PM2,5 · Sedang');
    expect(kartuRuas(v, 'X', src, 1, 2, 'no2', 'total').utama).toBe('30 µg/m³');
  });
  it('mode harga hirup', () => {
    const k = kartuRuas(v, undefined, src, 1, 2, 'aqi', 'harga');
    expect(k.judul).toBe('Ruas tanpa nama');
    expect(k.utama).toBe('1,2× median');
    expect(k.kategori).toBe('harga hirup · tinggi');
  });
  it('wilayah indikatif ditandai', () => {
    const s2 = { ...(src as object), manifest: { indicative: true } } as never;
    const k = kartuRuas(v, 'X', s2, 1, 2, 'aqi', 'traffic');
    expect(k.indikatif).toBe(true);
    expect(k.rincian.join(' ')).toContain('Indikatif');
  });
  it('nilai belum ada', () => {
    expect(kartuRuas(undefined, 'X', src, 1, 2, 'aqi', 'traffic').utama).toBe('Angka ruas ini sedang dimuat');
  });
  it('kategori asap mengikuti batas skala warna', () => {
    expect(kategoriAsap('no2', 1)).toBe('hampir tidak ada');
    expect(kategoriAsap('no2', 2)).toBe('sedikit');
    expect(kategoriAsap('no2', 50)).toBe('sangat banyak');
    expect(kategoriAsap('pm25', 4.5)).toBe('banyak');
  });
  it('saran jam', () => {
    expect(saranJam([{ ahead: 0, local_hour: 18, value: 10 }, { ahead: 19, local_hour: 13, value: 4.1 }])).toBe('Asap paling sedikit pukul 13.00 (−59%)');
    expect(saranJam([{ ahead: 0, local_hour: 18, value: 2 }, { ahead: 3, local_hour: 21, value: 1.9 }])).toBe('Jam ini termasuk yang paling sedikit asapnya');
    expect(saranJam([{ ahead: 0, local_hour: 18, value: 2 }])).toBe('');
  });
  it('buka dan tutup lewat event window', () => {
    const w = new EventTarget();
    (globalThis as { window?: unknown }).window = w;
    const seen: string[] = [];
    w.addEventListener(KARTU_BUKA, () => seen.push('buka'));
    w.addEventListener(KARTU_TUTUP, () => seen.push('tutup'));
    expect(kartuTerbuka()).toBe(false);
    tutupKartu(); // nothing open: no event
    bukaKartu({ id: 'a', kartu: kartuRuas(v, 'X', src, 1, 2, 'aqi', 'traffic') });
    expect(kartuTerbuka()).toBe(true);
    tutupKartu();
    expect(kartuTerbuka()).toBe(false);
    expect(seen).toEqual(['buka', 'tutup']);
  });
});
