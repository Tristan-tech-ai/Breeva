/**
 * POI packs (F1-69): every named place of a field region from Overture Maps places and OpenStreetMap, built by
 * scripts/field/build_poi_pack.py and served from the field CDN (tiles/poi/<release>/<region>.json, brotli). Inside a
 * region the map's POI layer reads the pack instead of the Geoapify proxy, which returned at most 100 places per view and
 * left the map incomplete (Tristan, 18 Nov 2026); the pack is also saved with the region for offline use.
 */
import type { POI } from './poi-api';
import { ROUTE_CACHE, cachedBytes } from './route/assets';

export const POI_RELEASE = '2026-10-21.0';
export const POI_ATTRIBUTION = 'Tempat: <a href="https://overturemaps.org">Overture Maps</a> (Meta, Microsoft, Foursquare, AllThePlaces dkk.) dan &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** One pack as stored: [name, category index, lat*1e5, lng*1e5, address]. */
export interface PoiPackFile { format: 'breeva_poi'; v: 1; region: string; release: string; cats: string[]; pois: Array<[string, number, number, number, string]> }

export function poiPackUrl(base: string, region: string): string {
  return `${base}/tiles/poi/${POI_RELEASE}/${region}.json`;
}

/** The pack as POI objects (types: the category and its parents, as the Geoapify results carried them). */
export function decodePoiPack(f: PoiPackFile): POI[] {
  if (f.format !== 'breeva_poi' || f.v !== 1) throw new Error('bukan paket POI Breeva v1');
  const types = f.cats.map((c) => c.split('.').map((_, i, a) => a.slice(0, a.length - i).join('.')));
  return f.pois.map(([name, ci, lat, lng, addr], i) => {
    const cat = f.cats[ci];
    return {
      id: `poi-${f.region}-${i}`,
      name,
      category: cat.split('.')[0],
      subcategory: cat.split('.').slice(0, 2).join('.'),
      coordinate: { lat: lat / 1e5, lng: lng / 1e5 },
      address: addr || undefined,
      types: types[ci],
    };
  });
}

/** POIs inside the box; with categories (Geoapify-style paths, comma lists allowed) only those or their children. */
export function poisInRect(pois: POI[], b: { south: number; west: number; north: number; east: number }, categories?: string): POI[] {
  const wanted = (categories ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  return pois.filter((p) => p.coordinate.lat >= b.south && p.coordinate.lat <= b.north && p.coordinate.lng >= b.west && p.coordinate.lng <= b.east
    && (!wanted.length || (p.types ?? []).some((t) => wanted.some((w) => t === w || t.startsWith(w + '.')))));
}

const loaded = new Map<string, Promise<POI[]>>();

/** The decoded pack of a region, once per page (cache first, so a saved region works offline). */
export function loadPoiPack(base: string, region: string, fetchBytes: typeof cachedBytes = cachedBytes): Promise<POI[]> {
  const url = poiPackUrl(base, region);
  let p = loaded.get(url);
  if (!p) {
    p = fetchBytes(url, { cacheFirst: true }).then((b) => decodePoiPack(JSON.parse(new TextDecoder().decode(b)) as PoiPackFile));
    p.catch(() => loaded.delete(url)); // a failed load may be tried again later
    loaded.set(url, p);
  }
  return p;
}

export { ROUTE_CACHE as POI_CACHE };
