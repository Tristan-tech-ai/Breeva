import { describe, expect, it } from 'vitest';
import { tabTempat } from '../src/lib/tabTempat';
import { poiCategoryLabel } from '../src/lib/poiPack';

describe('M-U10 lembar tempat', () => {
  it('tanpa sumber Google hanya Ringkasan dan Tentang', () => {
    expect(tabTempat(false).map((t) => t.label)).toEqual(['Ringkasan', 'Tentang']);
    expect(tabTempat(true).map((t) => t.label)).toEqual(['Ringkasan', 'Ulasan', 'Foto', 'Tentang']);
  });
  it('kategori dalam bahasa Indonesia, kesehatan umum tidak disebut klinik', () => {
    expect(poiCategoryLabel('healthcare')).toBe('Fasilitas kesehatan');
    expect(poiCategoryLabel('healthcare.hospital')).toBe('Rumah sakit');
    expect(poiCategoryLabel('healthcare.clinic')).toBe('Klinik');
  });
});
