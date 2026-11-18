/**
 * Breeva's own basemap (F1-68): vector tiles cut from a Protomaps daily build of OpenStreetMap (ODbL), one PMTiles
 * file per field region on the field CDN (tiles/basemap/<build>/<region>.pmtiles, z0-14, drawn up to z19 by overzoom).
 *
 * Why: the OpenStreetMap standard raster colours roads by class and draws its own POI icons, which clash with Breeva's
 * coloured roads and POI layer (Tristan, 18 Nov 2026). Here every road is the same neutral colour and the basemap has no
 * POIs at all, so only Breeva's colours carry meaning; street and place names stay.
 */
import type { Flavor } from '@protomaps/basemaps';
import { FIELD_REGIONS } from './field/source';

/** The Protomaps build the region files were cut from (pmtiles extract, 2026-11-17 build 4.15.2). */
export const BASEMAP_BUILD = '2026-11-17';
/** Highest zoom stored in the files; deeper zooms reuse z14 data (overzoom). */
export const BASEMAP_MAX_DATA_ZOOM = 14;
export const BASEMAP_ATTRIBUTION = '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function basemapUrl(base: string, region: string): string {
  return `${base}/tiles/basemap/${BASEMAP_BUILD}/${region}.pmtiles`;
}

/** The field region whose basemap file covers this point (its bounds plus a small margin), else null. */
export function basemapRegion(lat: number, lng: number, margin = 0.02): string | null {
  const r = FIELD_REGIONS.find((f) => lat >= f.bounds[0][0] - margin && lat <= f.bounds[1][0] + margin
    && lng >= f.bounds[0][1] - margin && lng <= f.bounds[1][1] + margin);
  return r ? r.name : null;
}

const ROAD_FILLS = ['highway', 'major', 'minor_a', 'minor_b', 'minor_service', 'link', 'other', 'pedestrian',
  'bridges_highway', 'bridges_major', 'bridges_minor', 'bridges_link', 'bridges_other',
  'tunnel_highway', 'tunnel_major', 'tunnel_minor', 'tunnel_link', 'tunnel_other'] as const;
const ROAD_CASINGS = ['highway_casing_early', 'highway_casing_late', 'major_casing_early', 'major_casing_late', 'minor_casing',
  'minor_service_casing', 'link_casing', 'bridges_highway_casing', 'bridges_major_casing', 'bridges_minor_casing',
  'bridges_link_casing', 'bridges_other_casing', 'tunnel_highway_casing', 'tunnel_major_casing', 'tunnel_minor_casing',
  'tunnel_link_casing', 'tunnel_other_casing'] as const;

/** A Protomaps flavour with one neutral road colour (no class colours) and no POI palette. */
export function breevaFlavor(baseFlavor: Flavor, dark: boolean): Flavor {
  const fill = dark ? '#2b3442' : '#ffffff';
  const casing = dark ? '#1e2530' : '#dfe3e8';
  const f: Flavor = { ...baseFlavor, pois: undefined, railway: dark ? '#3a4352' : '#c9ced6' };
  for (const k of ROAD_FILLS) f[k] = fill;
  for (const k of ROAD_CASINGS) f[k] = casing;
  return f;
}

/** Label rules without the POI layer: Breeva draws its own POIs (one source, F1-69). */
export function withoutPoiLabels<T extends { dataLayer: string }>(rules: T[]): T[] {
  return rules.filter((r) => r.dataLayer !== 'pois');
}
