import { describe, expect, it } from 'vitest';
import { tersediaDiPeta } from '../src/lib/field/tersedia';

describe('pilihan yang benar-benar bisa digambar /peta', () => {
  it('di luar pilot hanya asap kendaraan (ISPU dan NO2 memetakan ke NO2 knalpot), dengan alasan', () => {
    const t = tersediaDiPeta(true, true);
    expect([...t.mode]).toEqual(['traffic']);
    expect([...t.polutan].sort()).toEqual(['aqi', 'no2']);
    expect(t.alasan).toMatch(/hanya menghitung asap kendaraan/);
  });
  it('di dalam pilot O3 dan PM10 nonaktif karena medan tidak menghitungnya', () => {
    const t = tersediaDiPeta(true, false);
    expect(t.polutan.has('o3')).toBe(false);
    expect(t.polutan.has('pm10')).toBe(false);
    expect(t.polutan.has('pm25')).toBe(true);
    expect(t.mode.has('harga')).toBe(true);
    expect(t.alasan).toMatch(/O₃ dan PM₁₀/);
  });
  it('tanpa medan statis semua pilihan tetap', () => {
    expect(tersediaDiPeta(false, true).polutan.size).toBe(5);
  });
  it('objek yang sama untuk masukan yang sama', () => {
    expect(tersediaDiPeta(true, true)).toBe(tersediaDiPeta(true, true));
  });
});
