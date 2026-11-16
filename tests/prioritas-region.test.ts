import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoadPack } from '../scripts/field/pack';
// @ts-expect-error tsx script module, typed loosely here
import { facilityRows, MAJOR, RAMAI, toCsv } from '../scripts/field/facility-distances.mts';
import { PRIORITAS_REGIONS, pickPrioritasRegion } from '../src/lib/prioritas';

const pack = new RoadPack(new Uint8Array(readFileSync('tests/fixtures/pack_small.bin')));
// pack_small: road 0 is primary at about (-8.64992, 115.16655); road 1 is service at (-8.65212, 115.17614)

describe('facility table for a new region', () => {
  it('keeps the same facility kinds as the Badung list and measures metres to the busy and major roads', () => {
    const rows = facilityRows([
      { type: 'node', id: 1, lat: -8.65212, lon: 115.17614, tags: { amenity: 'school', name: 'SD Contoh' } },
      { type: 'way', id: 2, center: { lat: -8.64992, lon: 115.16655 }, tags: { amenity: 'clinic' } },
      { type: 'node', id: 3, lat: -8.65, lon: 115.17, tags: { amenity: 'pharmacy', name: 'Apotek' } },
      { type: 'node', id: 1, lat: -8.65212, lon: 115.17614, tags: { amenity: 'school', name: 'SD Contoh' } },
    ], pack);
    expect(rows.map((r: { id: number; kelas: string; jenis: string }) => [r.id, r.kelas, r.jenis])).toEqual([[1, 'pendidikan', 'school'], [2, 'kesehatan', 'clinic']]);
    expect(rows[1].d_ramai).toBeLessThan(5); // the clinic sits on the primary road
    expect(rows[1].jalan).toBe('primary');
    expect(rows[0].d_ramai).toBeGreaterThan(900); // the school is about 1 km from that road
    expect(rows[0].jarak_m).toBe(rows[0].d_ramai);
    expect(rows[1].nama).toBe('(clinic tanpa nama)');
    expect(MAJOR.has('secondary') && RAMAI.has('tertiary') && !MAJOR.has('tertiary')).toBe(true);
    expect(toCsv(rows).split('\n')[0]).toBe('t,id,kelas,jenis,nama,lat,lon,jarak_m,jalan,d_major,d_ramai');
  });
});

describe('priority list regions', () => {
  it('opens Badung-Denpasar by default and Kota Bogor (indicative) from ?wilayah=', () => {
    expect(pickPrioritasRegion('').name).toBe('badung_denpasar');
    expect(pickPrioritasRegion('?wilayah=kota_bogor')).toMatchObject({ name: 'kota_bogor', indicative: true });
    expect(pickPrioritasRegion('?wilayah=jakarta').name).toBe('badung_denpasar');
    expect(PRIORITAS_REGIONS.map((r) => r.name)).toEqual(['badung_denpasar', 'kota_bogor']);
  });

  it('the published Bogor list holds the facilities in the Badung shape', () => {
    const d = JSON.parse(readFileSync('public/data/prioritas/kota_bogor.json', 'utf8'));
    expect(d.wilayah).toBe('kota_bogor');
    expect(d.zona).toBe('UTC+7');
    expect(d.fasilitas.length).toBe(d.jumlah);
    expect(d.fasilitas[0]).toHaveProperty('pm25_lalin');
    expect(d.fasilitas.every((f: { lat: number }) => f.lat < -6.5 && f.lat > -6.7)).toBe(true);
  });
});
