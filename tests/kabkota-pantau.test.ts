import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiSini, bacaIndeks, cariKabKota, kabKotaCsv, latarSini, type KabKotaIndeks } from '../src/lib/nasional/kabkota';
import type { LatarFile } from '../src/lib/nasional/latar';
import type { FirePoint } from '../src/lib/nasional/firms';
import KabKotaView from '../src/components/pantau/KabKotaView';

const idx: KabKotaIndeks = {
  format: 'kabkota_indeks', kolom: [],
  baris: [
    ['kota-bogor', 'Kota Bogor', 'Jawa Barat', 'ID-JB', 106.8, -6.59, 106.7, -6.7, 106.9, -6.5],
    ['kabupaten-bogor', 'Kabupaten Bogor', 'Jawa Barat', 'ID-JB', 106.9, -6.5, 106.4, -6.8, 107.2, -6.2],
    ['kabupaten-ogan-komering-ilir', 'Kabupaten Ogan Komering Ilir', 'Sumatera Selatan', 'ID-SS', 105.6, -3.4, 104.9, -4.0, 106.2, -2.8],
  ],
};
const hours = Array.from({ length: 48 }, (_, k) => new Date(Date.UTC(2026, 10, 25, 11 + k)).toISOString().slice(0, 16) + 'Z');
const latar: LatarFile = {
  format: 'latar_nasional', updated_at: '', sumber: '', hours, jumlah: { terukur: 0, terkalibrasi: 0, indikatif: 1 },
  wilayah: { 'kabupaten-ogan-komering-ilir': { t: 'indikatif', s: 0, f: 1, v: hours.map((_, k) => 40 + k) } },
};
const fp = (lon: number, lat: number, slug?: string): FirePoint => [lon, lat, 12, 'h', '2026-11-25T06:00Z', 'N20', slug, slug ? 'ID-SS' : undefined];

describe('N-24 /pantau for every kab/kota', () => {
  const all = bacaIndeks(idx);
  it('reads the index and searches by name or province, names starting with the query first', () => {
    expect(all).toHaveLength(3);
    expect(cariKabKota(all, 'bogor').map((k) => k.slug)).toEqual(['kabupaten-bogor', 'kota-bogor']);
    expect(cariKabKota(all, 'ogan').map((k) => k.slug)).toEqual(['kabupaten-ogan-komering-ilir']);
    expect(cariKabKota(all, 'sumatera').map((k) => k.slug)).toEqual(['kabupaten-ogan-komering-ilir']);
    expect(cariKabKota(all, ' ')).toEqual([]);
  });
  it('takes the background value of the hour closest to now', () => {
    const l = latarSini(latar, 'kabupaten-ogan-komering-ilir', Date.UTC(2026, 10, 25, 14, 10))!;
    expect(l.i).toBe(3);
    expect(l.v).toBe(43);
    expect(latarSini(latar, 'kota-bogor')).toBeNull();
  });
  it('splits fire points into inside (tagged) and near (within 50 km)', () => {
    const k = all[2];
    const a = apiSini([fp(105.6, -3.4, k.slug), fp(105.9, -3.4, 'kabupaten-lain'), fp(110, -3, 'jauh')], k);
    expect(a.dalam).toHaveLength(1);
    expect(a.dekat).toHaveLength(1);
    expect(a.dekat[0].km).toBeGreaterThan(30);
  });
  it('writes a CSV with the 48 hours and the fire points', () => {
    const k = all[2];
    const csv = kabKotaCsv(k, latarSini(latar, k.slug, Date.UTC(2026, 10, 25, 11)), [fp(105.6, -3.4, k.slug)]);
    expect(csv.split('\n').filter((r) => r.startsWith('latar,'))).toHaveLength(48);
    expect(csv).toContain('titik_api,2026-11-25T06:00Z,,,-3.4,105.6,12,h');
  });
  it('the page names the level honestly and offers the CSV', () => {
    const html = renderToStaticMarkup(h(KabKotaView, { k: all[2], latar, fires: { format: 'titik_api', updated_at: '', sumber: '', window_hours: 24, n: 1, per_satelit: {}, points: [fp(105.6, -3.4, all[2].slug)] }, wind: null, hour: 0, dark: false }));
    expect(html).toContain('indikatif: belum ada titik ukur di dekatnya');
    expect(html).toContain('Unduh CSV');
    expect(html).toContain('Sumatera Selatan');
  });
});

describe('N-49 kab/kota in the main map search', () => {
  it('answers from 3 letters, by name only, at most 3, the name that starts with the query first', async () => {
    const { kabKotaUntukCari } = await import('../src/lib/nasional/kabkota');
    const all = bacaIndeks(idx);
    expect(kabKotaUntukCari(all, 'bo')).toEqual([]);
    expect(kabKotaUntukCari(all, 'bogor').map((k) => k.slug)).toEqual(['kabupaten-bogor', 'kota-bogor']);
    expect(kabKotaUntukCari(all, 'jawa barat')).toEqual([]); // a province alone does not list its kab/kota here
    expect(kabKotaUntukCari(all, 'ogan').map((k) => k.slug)).toEqual(['kabupaten-ogan-komering-ilir']);
  });
  it('the search box flies to zoom 13 and links to /pantau', () => {
    const src = readFileSync('src/components/map/SearchBar.tsx', 'utf8');
    expect(src).toContain('setViewTarget({ lat: k.lat, lng: k.lon, zoom: 13 })');
    expect(src).toContain('to={`/pantau/${k.slug}`}');
    expect(readFileSync('src/components/map/LeafletMap.tsx', 'utf8')).toContain('viewTarget.zoom ?? Math.max(map.getZoom(), 16)');
  });
});
