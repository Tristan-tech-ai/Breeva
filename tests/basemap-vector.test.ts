import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, WHITE } from '@protomaps/basemaps';
import { labelRules, paintRules } from 'protomaps-leaflet';
import { readFileSync } from 'node:fs';
import { basemapRegion, basemapUrl, breevaFlavor, pendingTileColor, withoutPoiLabels } from '../src/lib/basemapVector';

// F1-68: Breeva's basemap has one neutral road colour and no POIs (Tristan, 18 Nov 2026: basemap road colours and POI
// icons clashed with Breeva's own).
describe('vector basemap', () => {
  it('serves one file per field region under tiles/basemap/<build>/', () => {
    expect(basemapUrl('https://cdn.test', 'kota_bogor')).toBe('https://cdn.test/tiles/basemap/2026-11-17/kota_bogor.pmtiles');
  });

  it('finds the region whose basemap covers a point, and none outside', () => {
    expect(basemapRegion(-6.5966, 106.8047)).toBe('kota_bogor');
    expect(basemapRegion(-8.658, 115.216)).toBe('badung_denpasar');
    expect(basemapRegion(-6.2088, 106.8456)).toBeNull(); // Jakarta: no basemap file, the muted raster is used
  });

  it('paints roads in one neutral grey family (main roads a step darker), visible on the land, in light and dark', () => {
    for (const [base, dark] of [[WHITE, false], [DARK, true]] as const) {
      const f = breevaFlavor(base, dark);
      const kecil = [f.minor_a, f.minor_b, f.minor_service, f.link, f.other];
      const utama = [f.highway, f.major, f.bridges_major, f.tunnel_highway];
      expect(new Set(kecil).size).toBe(1);
      expect(new Set(utama).size).toBe(1);
      // T9 (27 Nov): with the pollution layer off, white roads on white land vanished
      expect(f.minor_a).not.toBe(f.earth);
      expect(f.major).not.toBe(f.earth);
      for (const c of [...kecil, ...utama]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      const casings = [f.highway_casing_early, f.major_casing_late, f.minor_casing, f.link_casing];
      expect(new Set(casings).size).toBe(1);
      expect(f.pois).toBeUndefined();
    }
    const before = WHITE.major;
    breevaFlavor(WHITE, false);
    expect(WHITE.major).toBe(before); // the stock flavour is not changed
  });

  it('draws no POI labels or icons', () => {
    // protomaps-leaflet 5.1.0 label rules cover roads, water and places only; the filter keeps it so if a later version
    // adds a POI layer
    const ours = withoutPoiLabels(labelRules(breevaFlavor(WHITE, false), 'id'));
    expect(ours.some((r) => r.dataLayer === 'pois')).toBe(false);
    expect(ours.some((r) => r.dataLayer === 'roads')).toBe(true); // street names stay
    expect(ours.some((r) => r.dataLayer === 'places')).toBe(true);
    expect(withoutPoiLabels([{ dataLayer: 'pois' }, { dataLayer: 'roads' }])).toEqual([{ dataLayer: 'roads' }]);
    expect(paintRules(breevaFlavor(WHITE, false)).some((r) => r.dataLayer === 'roads')).toBe(true);
    expect(labelRules(LIGHT, 'id').some((r) => r.dataLayer === 'pois')).toBe(false);
  });

  it('shows the land colour, not Leaflet grey, where a tile is still loading (X-W56)', () => {
    expect(pendingTileColor(breevaFlavor(WHITE, false))).toBe('#ffffff');
    expect(pendingTileColor(breevaFlavor(DARK, true))).toBe('#1f1f1f');
    expect(pendingTileColor({ earth: '', background: '#123456' })).toBe('#123456');
    const src = readFileSync('src/components/map/VectorBasemap.tsx', 'utf8');
    expect(src).toMatch(/box\.style\.backgroundColor = pendingTileColor\(flavor\)/);
    expect(src).toMatch(/style\.backgroundColor = restoreBg/); // and put back when the vector basemap goes
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/html \.leaflet-container \{\s*background-color: #ffffff;/);
    expect(css).toMatch(/html\.dark \.leaflet-container \{\s*background-color: #1f1f1f;/);
  });
});
