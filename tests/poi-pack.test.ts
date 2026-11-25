import { describe, expect, it } from 'vitest';
import { decodePoiPack, loadPoiPack, normName, poiCategoryLabel, poiPackUrl, poisInRect, searchPoiPack, type PoiPackFile } from '../src/lib/poiPack';

// F1-69: one POI source per field region (Overture places + OSM), read from a static pack instead of Geoapify (which
// returned at most 100 places per view).
const PACK: PoiPackFile = {
  format: 'breeva_poi', v: 1, region: 'kota_bogor', release: '2026-10-21.0',
  cats: ['catering.cafe', 'education.school', 'service.financial.atm'],
  pois: [
    ['Kopi Tuku', 0, -659500, 10680400, 'Jl. Pajajaran'],
    ['SMA Negeri 1 Bogor', 1, -659000, 10679900, ''],
    ['ATM BCA', 2, -660000, 10680000, ''],
    ['Kafe jauh', 0, -650000, 10670000, ''],
  ],
};

describe('POI packs', () => {
  it('serves one pack per region under tiles/poi/<release>/', () => {
    expect(poiPackUrl('https://cdn.test', 'kota_bogor')).toBe('https://cdn.test/tiles/poi/2026-10-21.1/kota_bogor.json');
  });

  it('decodes names, categories with their parents, coordinates and addresses', () => {
    const p = decodePoiPack(PACK);
    expect(p).toHaveLength(4);
    expect(p[0]).toMatchObject({ name: 'Kopi Tuku', category: 'catering', subcategory: 'catering.cafe', coordinate: { lat: -6.595, lng: 106.804 }, address: 'Jl. Pajajaran' });
    expect(p[0].types).toEqual(['catering.cafe', 'catering']);
    expect(p[1].address).toBeUndefined();
    expect(new Set(p.map((x) => x.id)).size).toBe(4);
    expect(() => decodePoiPack({ ...PACK, v: 2 } as unknown as PoiPackFile)).toThrow();
  });

  it('keeps the places inside the box, all of them without a category filter (no 100 limit)', () => {
    const p = decodePoiPack(PACK);
    const box = { south: -6.61, west: 106.79, north: -6.58, east: 106.81 };
    expect(poisInRect(p, box).map((x) => x.name)).toEqual(['Kopi Tuku', 'SMA Negeri 1 Bogor', 'ATM BCA']);
    const many = { ...PACK, pois: Array.from({ length: 500 }, (_, i) => ['Warung ' + i, 0, -659500, 10680400, ''] as [string, number, number, number, string]) };
    expect(poisInRect(decodePoiPack(many), box)).toHaveLength(500);
  });

  it('filters by Geoapify-style category lists, matching children of a listed category', () => {
    const p = decodePoiPack(PACK);
    const box = { south: -6.61, west: 106.79, north: -6.58, east: 106.81 };
    expect(poisInRect(p, box, 'catering.cafe,catering.coffee_shop').map((x) => x.name)).toEqual(['Kopi Tuku']);
    expect(poisInRect(p, box, 'catering').map((x) => x.name)).toEqual(['Kopi Tuku']);
    expect(poisInRect(p, box, 'service.financial.atm,service.financial.bank').map((x) => x.name)).toEqual(['ATM BCA']);
    expect(poisInRect(p, box, 'religion')).toEqual([]);
  });

  it('loads a pack once per page, cache first, and tries again after a failure', async () => {
    let calls = 0;
    const body = new TextEncoder().encode(JSON.stringify(PACK));
    const ok = (async (_u: string, o: { cacheFirst: boolean }) => { calls++; expect(o.cacheFirst).toBe(true); return body; }) as never;
    const a = await loadPoiPack('https://a.test', 'kota_bogor', ok);
    const b = await loadPoiPack('https://a.test', 'kota_bogor', ok);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    let fails = 0;
    const bad = (async () => { fails++; throw new Error('offline'); }) as never;
    await expect(loadPoiPack('https://b.test', 'kota_bogor', bad)).rejects.toThrow('offline');
    await expect(loadPoiPack('https://b.test', 'kota_bogor', bad)).rejects.toThrow('offline');
    expect(fails).toBe(2);
  });

  it('searches names offline: start of name, then start of a word, then anywhere; nearest first within a rank (F1-71)', () => {
    const p = decodePoiPack(PACK);
    expect(normName('Kopi TUKU - Pajajaran')).toBe('kopi tuku pajajaran');
    expect(searchPoiPack(p, 'kopi tuku').map((x) => x.name)).toEqual(['Kopi Tuku']);
    expect(searchPoiPack(p, 'TUKU').map((x) => x.name)).toEqual(['Kopi Tuku']);
    expect(searchPoiPack(p, 'bca').map((x) => x.name)).toEqual(['ATM BCA']);
    expect(searchPoiPack(p, 'k')).toEqual([]); // one letter is too little
    const hotel = decodePoiPack({ ...PACK, pois: [['Swissbel Hotel Bogor', 0, -659500, 10680400, '']] });
    expect(searchPoiPack(hotel, 'Swiss-Belhotel').map((x) => x.name)).toEqual(['Swissbel Hotel Bogor']); // spaces differ between sources
    const two = decodePoiPack({ ...PACK, pois: [['Kafe Jauh', 0, -650000, 10670000, ''], ['Kafe Dekat', 0, -659500, 10680400, '']] });
    expect(searchPoiPack(two, 'kafe', { lat: -6.595, lng: 106.804 }).map((x) => x.name)).toEqual(['Kafe Dekat', 'Kafe Jauh']);
    expect(searchPoiPack(two, 'kafe', undefined, 1)).toHaveLength(1);
    const twice = decodePoiPack({ ...PACK, pois: [['Museum Bali', 0, -865800, 11521600, ''], ['Museum Bali', 0, -865850, 11521650, ''], ['Museum Bali', 0, -870000, 11520000, '']] });
    expect(searchPoiPack(twice, 'museum bali')).toHaveLength(2); // the same place mapped twice shows once; one 5 km away stays
  });

  it('finds a place by its full name when the source lists a shorter one, never by one common word (X-W47)', () => {
    const inna = decodePoiPack({ ...PACK, pois: [['Inna Bali', 0, -865459, 11521690, 'Jalan Veteran 3'], ['Bali', 0, -865000, 11521000, ''], ['Inna Bali Beach Resort', 0, -869781, 11525388, '']] });
    expect(searchPoiPack(inna, 'Inna Bali Heritage').map((x) => x.name)).toEqual(['Inna Bali']);
    expect(searchPoiPack(inna, 'inna bali').map((x) => x.name)).toEqual(['Inna Bali', 'Inna Bali Beach Resort']); // a name match still ranks first
    expect(searchPoiPack(inna, 'bali museum')).toEqual([]); // the one-word name 'Bali' is not a match for a longer query
    expect(searchPoiPack(inna, 'inna balinese')).toEqual([]); // whole words only
  });

  it('labels categories in Indonesian for search results, most specific first', () => {
    expect(poiCategoryLabel('catering.cafe')).toBe('Kafe');
    expect(poiCategoryLabel('catering.restaurant')).toBe('Rumah makan');
    expect(poiCategoryLabel('religion.place_of_worship.hinduism')).toBe('Pura');
    expect(poiCategoryLabel('service.vehicle.fuel')).toBe('SPBU');
    expect(poiCategoryLabel('healthcare.hospital')).toBe('Rumah sakit');
    expect(poiCategoryLabel('healthcare.clinic')).toBe('Klinik');
    expect(poiCategoryLabel('something.else')).toBe('Tempat');
    expect(poiCategoryLabel(undefined)).toBe('Tempat');
  });
});

describe('N-47 place search on a large pack', () => {
  it('normalises the names once per pack and keeps the same answers on repeated searches', () => {
    const big = Array.from({ length: 40000 }, (_, i) => ({ id: String(i), name: i === 39999 ? 'Kopi Tuku Bogor' : `Toko Nomor ${i}`, coordinate: { lat: -6.6 + i * 1e-6, lng: 106.8 }, types: ['shop'] })) as unknown as Parameters<typeof searchPoiPack>[0];
    const t0 = performance.now();
    const a = searchPoiPack(big, 'kopi tuku');
    const first = performance.now() - t0;
    const t1 = performance.now();
    const b = searchPoiPack(big, 'kopi tuk');
    const second = performance.now() - t1;
    expect(a.map((x) => x.name)).toEqual(['Kopi Tuku Bogor']);
    expect(b.map((x) => x.name)).toEqual(['Kopi Tuku Bogor']);
    expect(second).toBeLessThan(first); // the second search reuses the normalised names
  });
});
