import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kotaLapisan, teksTitikKota, type KotaTitik } from '../src/lib/sensorTitik';

// M-T10: the ten-city sensor points on the app layer.
const kota = (JSON.parse(readFileSync('public/data/titik_sensor/sepuluh_kota.json', 'utf8')) as { kota: KotaTitik[] }).kota;

describe('kotaLapisan', () => {
  it('drops Bali (pilot points are finer there) and keeps the other nine cities', () => {
    const k = kotaLapisan(kota);
    expect(k.some((x) => x.kota.startsWith('Bali'))).toBe(false);
    expect(k.length).toBe(kota.length - 1);
  });
  it('gives each kept city three ranked points with coordinates in Indonesia', () => {
    for (const k of kotaLapisan(kota)) {
      expect(k.titik.map((t) => t.peringkat)).toEqual([1, 2, 3]);
      for (const t of k.titik) {
        expect(t.lat).toBeGreaterThan(-11.5); expect(t.lat).toBeLessThan(6.5);
        expect(t.lon).toBeGreaterThan(94); expect(t.lon).toBeLessThan(141.5);
      }
    }
  });
});

describe('teksTitikKota', () => {
  it('names the city, the rank and says indikatif with an Indonesian percentage', () => {
    const k: KotaTitik = { kota: 'Bandung', sensor_ada: 0, titik: [{ peringkat: 1, nama: 'Kota Bandung', lat: -6.9, lon: 107.6, manfaat_pct: 63.35 }] };
    const r = teksTitikKota(k, k.titik[0]);
    expect(r.judul).toBe('Bandung 2027, titik sensor 1: Kota Bandung');
    expect(r.kalimat).toContain('63,4%');
    expect(r.kalimat).toMatch(/Indikatif/);
  });
});
