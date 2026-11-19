import { describe, expect, it } from 'vitest';
import { decodePoiPack } from '../src/lib/poiPack';
import { foundByName } from '../scripts/field/cek-cari-prioritas.mts';

// X-W72: a priority facility counts as findable when the offline search returns the same name within 300 m.
const pois = decodePoiPack({
  format: 'breeva_poi', v: 1, region: 'kota_bogor', release: 't', cats: ['education.school'],
  pois: [['SMA Negeri 1 Bogor', 0, -659733, 10679335, ''], ['SD Negeri Panaragan', 0, -660000, 10679000, '']],
});

describe('priority facility search check', () => {
  it('finds a facility by its name next to its point', () => {
    expect(foundByName(pois, { id: 'a', nama: 'SMA Negeri 1 Bogor', kelas: 'pendidikan', jenis: 'school', lat: -6.59735, lon: 106.79337 })).toBe(true);
  });
  it('does not count the same name 5 km away, another name, or no name', () => {
    expect(foundByName(pois, { id: 'b', nama: 'SMA Negeri 1 Bogor', kelas: 'pendidikan', jenis: 'school', lat: -6.55, lon: 106.79 })).toBe(false);
    expect(foundByName(pois, { id: 'c', nama: 'SMA Negeri 2 Bogor', kelas: 'pendidikan', jenis: 'school', lat: -6.59735, lon: 106.79337 })).toBe(false);
    expect(foundByName(pois, { id: 'd', nama: null, kelas: 'pendidikan', jenis: 'school', lat: -6.59735, lon: 106.79337 })).toBe(false);
  });
});
