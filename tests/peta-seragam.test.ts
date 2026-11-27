import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASEMAP_BUILD, BASEMAP_NATIONAL, basemapFile, basemapUrl } from '../src/lib/basemapVector';
import { fieldKind } from '../src/lib/pwa/fieldCache';
import { KODE_KELAS, LABEL_ASAP_NASIONAL } from '../src/lib/nasional/ubinView';
import { opacityFor, weightFor } from '../src/lib/roadColors';
import { stationAsBadge, STATION_BADGE_ZOOM } from '../src/lib/stationBbox';
import { firstFixView } from '../src/stores/mapStore';
import { ikonUsulan, LEGENDA_BUTA, SLUG_KABUT_PILOT, slugButa } from '../src/lib/sensorTitik';

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
    expect(LEGENDA_BUTA).toMatch(/sensor yang ada/);
    expect(LEGENDA_BUTA).toMatch(/usulan sensor baru/);
    const layer = readFileSync('src/components/map/LapisanAplikasi.ts', 'utf8');
    expect(layer).toMatch(/ikonUsulan\('\+'\)/);
    expect(layer).not.toMatch(/background:#15803d;color:#fff/); // the old filled green pin
  });
});
