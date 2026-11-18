import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, WHITE } from '@protomaps/basemaps';
import { labelRules, paintRules } from 'protomaps-leaflet';
import { basemapRegion, basemapUrl, breevaFlavor, withoutPoiLabels } from '../src/lib/basemapVector';

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

  it('paints every road class the same neutral colour in light and dark', () => {
    for (const [base, dark] of [[WHITE, false], [DARK, true]] as const) {
      const f = breevaFlavor(base, dark);
      const roads = [f.highway, f.major, f.minor_a, f.minor_b, f.minor_service, f.link, f.other, f.bridges_major, f.tunnel_highway];
      expect(new Set(roads).size).toBe(1);
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
});
