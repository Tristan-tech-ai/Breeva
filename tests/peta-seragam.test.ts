import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASEMAP_BUILD, BASEMAP_NATIONAL, basemapFile, basemapUrl } from '../src/lib/basemapVector';
import { fieldKind } from '../src/lib/pwa/fieldCache';
import { KODE_KELAS, LABEL_ASAP_NASIONAL } from '../src/lib/nasional/ubinView';
import { opacityFor, weightFor } from '../src/lib/roadColors';
import { stationAsBadge, STATION_BADGE_ZOOM } from '../src/lib/stationBbox';
import { firstFixView } from '../src/stores/mapStore';
import { sudahDibaca, tandaiDibaca } from '../src/lib/map/catatanDibaca';
import { ikonUsulan, kmAntara, LEGENDA_BUTA, SLUG_KABUT_PILOT, slugBerisiTitik, slugButa, slugDenganStasiun, slugTerukur, titikDalamPoligon, TOP_NASIONAL, usulanUntukZoom, ZOOM_SEMUA_KABKOTA, ZOOM_TITIK_KOTA, type Usulan } from '../src/lib/sensorTitik';

// Tristan, 27 Nov 2026 (T6): the pilot regions looked like a different map, the map jumped back on its own, the note on
// national roads said nothing to a user, WAQI stations could not be seen, and proposed sensor points read as stations.

describe('one basemap for the whole country (M-U16)', () => {
  it('online the national file draws a pilot region and any other place in Indonesia alike', () => {
    expect(basemapFile(-8.67, 115.21, true)).toBe('indonesia'); // Denpasar (pilot)
    expect(basemapFile(-6.595, 106.797, true)).toBe('indonesia'); // Kota Bogor (pilot)
    expect(basemapFile(-6.2, 106.83, true)).toBe('indonesia'); // Jakarta
    expect(basemapFile(-0.9, 131.25, true)).toBe('indonesia'); // Sorong
    expect(basemapFile(35.68, 139.76, true)).toBeNull(); // Tokyo: the raster fallback
  });

  it('offline a saved pilot region keeps its own file; elsewhere there is none', () => {
    expect(basemapFile(-8.67, 115.21, false)).toBe('badung_denpasar');
    expect(basemapFile(-6.595, 106.797, false)).toBe('kota_bogor');
    expect(basemapFile(-6.2, 106.83, false)).toBeNull();
  });

  it('the two kinds of file have their own paths, and only the region files are kept for offline', () => {
    const nat = basemapUrl('https://cdn.example', BASEMAP_NATIONAL.name), reg = basemapUrl('https://cdn.example', 'kota_bogor');
    expect(nat).toBe(`https://cdn.example/tiles/basemap/${BASEMAP_NATIONAL.build}/indonesia.pmtiles`);
    expect(reg).toBe(`https://cdn.example/tiles/basemap/${BASEMAP_BUILD}/kota_bogor.pmtiles`);
    expect(fieldKind(new URL(nat), 'https://breeva.site')).toBeNull();
    expect(fieldKind(new URL(reg), 'https://breeva.site')).toBe('geometry');
  });
});

describe('national roads drawn like pilot roads (M-U16)', () => {
  it('the national layer takes its width and opacity from the pilot rules, by class and zoom', () => {
    const src = readFileSync('src/components/map/NationalExhaustLayer.ts', 'utf8');
    expect(src).toMatch(/weightFor\(hw, z\)/);
    expect(src).toMatch(/opacityFor\(hw, z, 0\.9\)/);
    expect(src).not.toMatch(/weight: t\.k\[i\] <= 3 \? 4/); // the old fixed 4 / 3 / 2 px
    // a lane is a hairline at z13 and a main road is not, in both layers
    expect(weightFor(KODE_KELAS[7], 13)).toBeLessThan(1);
    expect(weightFor(KODE_KELAS[2], 13)).toBeGreaterThan(1.5);
    expect(opacityFor(KODE_KELAS[7], 13, 0.9)).toBeLessThan(0.9);
    expect(Object.keys(KODE_KELAS)).toHaveLength(9);
  });

  it('the note on those roads is plain words', () => {
    expect(LABEL_ASAP_NASIONAL).toMatch(/^Asap kendaraan: perkiraan/);
    expect(LABEL_ASAP_NASIONAL).not.toMatch(/indikatif|ponsel/i);
  });
});

describe('notes read once and closed with Oke (M-U18)', () => {
  it('a closed note stays closed on this device; blocked storage does not break anything', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(sudahDibaca('asap_nasional', s)).toBe(false);
    tandaiDibaca('asap_nasional', s);
    expect(sudahDibaca('asap_nasional', s)).toBe(true);
    expect(sudahDibaca('legenda_buta', s)).toBe(false); // each note on its own
    const rusak = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(sudahDibaca('asap_nasional', rusak)).toBe(false);
    expect(() => tandaiDibaca('asap_nasional', rusak)).not.toThrow();
    expect(sudahDibaca('asap_nasional', null)).toBe(false);
  });

  it('both map notes use it, with an Oke button', () => {
    expect(readFileSync('src/components/map/NationalExhaustLayer.ts', 'utf8')).toMatch(/catatanSekali\('asap_nasional'/);
    expect(readFileSync('src/components/map/LapisanAplikasi.ts', 'utf8')).toMatch(/catatanSekali\('legenda_buta'/);
    const src = readFileSync('src/lib/map/catatanSekali.ts', 'utf8');
    expect(src).toMatch(/textContent = 'Oke'/);
    expect(src).toMatch(/min-width:44px/);
  });
});

describe('a late GPS fix does not pull the map back (M-U16)', () => {
  const here = { lat: -8.66, lng: 115.21 }, looking = { lat: -7.6, lng: 112.5 };
  it('centres the map only while the user has not touched it, or when they asked', () => {
    expect(firstFixView(here, looking, false, false).center).toEqual(here);
    expect(firstFixView(here, looking, true, false).center).toEqual(looking);
    expect(firstFixView(here, looking, true, true).center).toEqual(here);
    expect(firstFixView(here, looking, true, false).userLocation).toEqual(here); // the position itself always arrives
  });
});

describe('WAQI stations everywhere (M-U17)', () => {
  it('no pilot filter is left, and far out a station is a dot instead of a badge', () => {
    const src = readFileSync('src/components/map/AQIStationLayer.tsx', 'utf8');
    expect(src).not.toMatch(/inPilot/);
    expect(src).toMatch(/AQI AS/);
    expect(stationAsBadge(STATION_BADGE_ZOOM)).toBe(true);
    expect(stationAsBadge(STATION_BADGE_ZOOM - 1)).toBe(false);
  });
});

describe('blind areas, not pins that read as stations (M-U14)', () => {
  it('a proposed point is hollow and dashed, never a filled pin', () => {
    const html = ikonUsulan('+');
    expect(html).toMatch(/border:2px dashed/);
    expect(html).toMatch(/background:rgba\(255,255,255/);
    expect(html).toMatch(/data-usulan-sensor/);
    expect(ikonUsulan('3', { ukuran: 28, aktif: true })).toMatch(/width:28px/);
  });

  it('the national fog covers every kab/kota without a sensor nearby, except those with a pilot image', () => {
    const wilayah = { 'kota-bandung': { t: 'indikatif' }, 'kota-medan': { t: 'terkalibrasi' }, 'kota-denpasar': { t: 'terukur' }, 'kota-bogor': { t: 'indikatif' }, 'kabupaten-gianyar': { t: 'terukur' } };
    expect([...slugButa(wilayah)].sort()).toEqual(['kota-bandung', 'kota-medan']);
    // the slugs of the pilot images exist in the polygon file the fog is drawn from
    const slugs = new Set((JSON.parse(readFileSync('public/data/kabkota_peta_kasar.geojson', 'utf8')) as { features: Array<{ properties: { s: string } }> }).features.map((f) => f.properties.s));
    for (const s of SLUG_KABUT_PILOT) expect(slugs.has(s)).toBe(true);
  });

  it('the legend names the three things on the layer in plain words', () => {
    expect(LEGENDA_BUTA).toMatch(/peta buta/);
    expect(LEGENDA_BUTA).toMatch(/sensor dan stasiun yang ada/);
    expect(LEGENDA_BUTA).toMatch(/usulan sensor baru/);
    const layer = readFileSync('src/components/map/LapisanAplikasi.ts', 'utf8');
    expect(layer).toMatch(/ikonUsulan\(u\.teks/);
    expect(layer).not.toMatch(/background:#15803d;color:#fff/); // the old filled green pin
  });
});

describe('covered places green, proposals that do not pile up, one in every blind kab/kota (T9)', () => {
  const u = (grup: string, peringkat: number, lat: number, lon: number, urutanNasional?: number): Usulan =>
    ({ lat, lon, grup, peringkat, nama: `${grup} ${peringkat}`, judul: `${grup} ${peringkat}`, kalimat: '', tautan: '/', teksTautan: '', urutanNasional });
  const daftar = [
    u('Kota Bogor', 2, -6.60, 106.80), u('Kota Bogor', 1, -6.59, 106.79), u('Kota Bogor', 3, -6.58, 106.78),
    u('Bandung', 1, -6.91, 107.61),
    u('nasional', 1, -6.2, 107.1, 1), u('nasional', 40, -7.0, 110.0, 40), u('nasional', 999, -3.0, 120.0),
  ];

  it('zoomed out: one marker per city with its count, at its first point; a tap zooms in', () => {
    const m = usulanUntukZoom(daftar, ZOOM_TITIK_KOTA - 1);
    const bogor = m.filter((x) => x.judul.includes('Kota Bogor'));
    expect(bogor).toHaveLength(1);
    expect(bogor[0]).toMatchObject({ teks: '3', lat: -6.59, perbesar: true });
    expect(m.find((x) => x.judul === 'Bandung 1')?.teks).toBe('1'); // a city with one point shows it
  });

  it('zoomed in: every city point with its rank', () => {
    const m = usulanUntukZoom(daftar, ZOOM_TITIK_KOTA);
    expect(m.filter((x) => x.judul.startsWith('Kota Bogor')).map((x) => x.teks)).toEqual(['1', '2', '3']);
  });

  it('kab/kota centres: the national top 30 always, every blind one from zoom 8', () => {
    const jauh = usulanUntukZoom(daftar, ZOOM_SEMUA_KABKOTA - 1).filter((x) => x.teks === '+');
    expect(jauh).toHaveLength(1);
    expect(TOP_NASIONAL).toBe(30);
    expect(usulanUntukZoom(daftar, ZOOM_SEMUA_KABKOTA).filter((x) => x.teks === '+')).toHaveLength(3);
  });

  it('green where a sensor is within 25 km, orange elsewhere, the pilot images left to themselves', () => {
    const wilayah = { 'kota-bandung': { t: 'indikatif' }, 'kabupaten-gianyar': { t: 'terukur' }, 'kota-denpasar': { t: 'terukur' }, 'kota-medan': { t: 'terkalibrasi' } };
    expect([...slugTerukur(wilayah)]).toEqual(['kabupaten-gianyar']);
    expect([...slugButa(wilayah)].sort()).toEqual(['kota-bandung', 'kota-medan']);
    expect(LEGENDA_BUTA).toMatch(/^Hijau: sudah ada alat ukur/);
    expect(kmAntara({ lat: -6.59, lon: 106.79 }, { lat: -6.59, lon: 106.97 })).toBeGreaterThan(19);
    const layer = readFileSync('src/components/map/LapisanAplikasi.ts', 'utf8');
    expect(layer).toMatch(/fillColor: '#16a34a'/);
    expect(layer).toMatch(/butuh_sensor\.json/);
  });
});

describe('a place with a station is not blind (T9)', () => {
  it('kab/kota with a station within 25 km of the centre count as reached', () => {
    const kab = [{ slug: 'kota-a', lat: -6.2, lon: 106.8 }, { slug: 'kab-b', lat: -7.5, lon: 110.0 }];
    expect([...slugDenganStasiun(kab, [{ lat: -6.3, lon: 106.85 }])]).toEqual(['kota-a']); // about 12 km
    expect(slugDenganStasiun(kab, [{ lat: -6.6, lon: 107.2 }]).size).toBe(0); // about 63 km
    expect(slugDenganStasiun(kab, []).size).toBe(0);
    expect(LEGENDA_BUTA).toMatch(/sensor warga atau stasiun/);
    expect(readFileSync('src/components/map/LapisanAplikasi.ts', 'utf8')).toMatch(/waqi-stations\?bbox=-11\.5,94\.5,6\.5,141\.5/);
  });
});

describe('a kab/kota with its own station is green, however big (T9)', () => {
  const kotak = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  it('point in polygon, also a MultiPolygon and a hole', () => {
    expect(titikDalamPoligon(1, 1, kotak(0, 0, 2, 2))).toBe(true);
    expect(titikDalamPoligon(3, 1, kotak(0, 0, 2, 2))).toBe(false);
    expect(titikDalamPoligon(5, 5, { type: 'MultiPolygon', coordinates: [kotak(0, 0, 2, 2).coordinates, kotak(4, 4, 6, 6).coordinates] })).toBe(true);
    const berlubang = { type: 'Polygon', coordinates: [kotak(0, 0, 4, 4).coordinates[0], kotak(1, 1, 3, 3).coordinates[0]] };
    expect(titikDalamPoligon(2, 2, berlubang)).toBe(false);
    expect(titikDalamPoligon(0.5, 0.5, berlubang)).toBe(true);
  });
  it('a station 60 km from the centre of its big kabupaten still makes it reached', () => {
    const fc = { features: [{ properties: { s: 'kab-besar' }, geometry: kotak(119, -2, 121, 0) }, { properties: { s: 'kab-lain' }, geometry: kotak(121, -2, 122, 0) }] };
    expect([...slugBerisiTitik(fc, [{ lat: -0.5, lon: 119.9 }])]).toEqual(['kab-besar']);
    expect(slugDenganStasiun([{ slug: 'kab-besar', lat: -1, lon: 120.4 }], [{ lat: -0.5, lon: 119.9 }]).size).toBe(0); // the old rule missed it
  });
});
