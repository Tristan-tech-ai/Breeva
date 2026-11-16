import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeName, schoolList, searchSchools } from '../src/lib/route/schools';

const file = {
  points: [[-8.65, 115.2], [-8.66, 115.21], [-8.67, 115.22], [-8.68, 115.23], [-8.68001, 115.23001], [-8.69, 115.24]] as Array<[number, number]>,
  names: ['SMA Negeri 1 Denpasar', 'SMAN 2 Denpasar', 'SMK TI Global Denpasar', 'TK Kartika', 'TK Kartika', ''],
  kinds: ['school', 'school', 'school', 'kindergarten', 'kindergarten', 'school'] as Array<'school' | 'kindergarten'>,
};

describe('school search', () => {
  it('normalises case, accents and abbreviations', () => {
    expect(normalizeName('SMAN 2  Denpasar')).toBe('sma negeri 2 denpasar');
    expect(normalizeName('SMKN-1 Kuta')).toBe('smk negeri 1 kuta');
    expect(normalizeName('Sekolah Dasar Négeri')).toBe('sekolah dasar negeri');
  });

  it('lists named schools once and skips unnamed points', () => {
    const l = schoolList(file);
    expect(l.map((e) => e.name)).toEqual(['SMA Negeri 1 Denpasar', 'SMAN 2 Denpasar', 'SMK TI Global Denpasar', 'TK Kartika']);
    expect(l[3]).toMatchObject({ kind: 'kindergarten', lat: -8.68, lng: 115.23, k: 3 });
  });

  it('finds by any spelling of the abbreviation and by words in any order', () => {
    const l = schoolList(file);
    expect(searchSchools(l, 'sman 1').map((e) => e.name)).toEqual(['SMA Negeri 1 Denpasar']);
    expect(searchSchools(l, 'sma negeri 2').map((e) => e.name)).toEqual(['SMAN 2 Denpasar']);
    expect(searchSchools(l, 'global smk').map((e) => e.name)).toEqual(['SMK TI Global Denpasar']);
    expect(searchSchools(l, 'denpasar').map((e) => e.name)).toEqual(['SMAN 2 Denpasar', 'SMA Negeri 1 Denpasar', 'SMK TI Global Denpasar'].sort((a, b) => normalizeName(a).length - normalizeName(b).length || a.localeCompare(b)));
    expect(searchSchools(l, '')).toEqual([]);
    expect(searchSchools(l, 'universitas')).toEqual([]);
  });

  it('on the real Badung-Denpasar file finds SMA and SMK by name', () => {
    const f = JSON.parse(readFileSync('tests/fixtures/schools_badung_names.json', 'utf8'));
    const l = schoolList(f);
    expect(l.length).toBeGreaterThan(200);
    expect(searchSchools(l, 'sma negeri 1 denpasar')[0].name).toMatch(/SMA Negeri 1 Denpasar|SMAN 1 Denpasar/i);
    expect(searchSchools(l, 'smk ti global')[0].name).toBe('SMK TI Global Denpasar');
  });
});
