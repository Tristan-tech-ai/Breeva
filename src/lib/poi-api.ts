import type { Coordinate } from '../types';
import { diagLog } from './poi-diagnostics';

const GEOAPIFY_KEY = '113d32cb776247bcb192cbb67b91330e';

export interface POI {
  id: string;
  name: string;
  /** Root category e.g. "catering", "commercial", "accommodation" */
  category: string;
  /** Subcategory path e.g. "catering.restaurant", "commercial.supermarket" */
  subcategory?: string;
  coordinate: Coordinate;
  distance?: number;
  address?: string;
  rating?: number;
  reviewCount?: number;
  phone?: string;
  website?: string;
  tags?: Record<string, string>;
  placeId?: string;
  dataId?: string;
  thumbnail?: string;
  openState?: string;
  /** Full Geoapify category paths e.g. ["catering.restaurant.indonesian", "catering.restaurant", "catering"] */
  types?: string[];
  price?: string;
  description?: string;
}

// ─── localStorage POI cache (persists across page reloads) ──────────

const POI_CACHE_PREFIX = 'breeva_poi_';
const POI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function poiCacheKey(lat: number, lng: number, query: string): string {
  // Grid-rounded coords are already passed in, so key is stable
  return `${POI_CACHE_PREFIX}${lat.toFixed(2)}_${lng.toFixed(2)}_${query.slice(0, 40)}`;
}

function getCachedPOIs(key: string): POI[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, pois } = JSON.parse(raw) as { ts: number; pois: POI[] };
    if (Date.now() - ts > POI_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return pois;
  } catch {
    return null;
  }
}

function setCachedPOIs(key: string, pois: POI[]): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), pois }));
  } catch {
    // Storage full — evict oldest POI cache entries
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(POI_CACHE_PREFIX)) keys.push(k);
      }
      // Remove oldest half
      keys.sort();
      for (const k of keys.slice(0, Math.ceil(keys.length / 2))) {
        localStorage.removeItem(k);
      }
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), pois }));
    } catch { /* give up */ }
  }
}

// ─── Geoapify Places API ─────────────────────────────────────────────

const DEFAULT_CATEGORIES = 'catering,accommodation,commercial,tourism,leisure.park,religion,service.financial.atm,service.vehicle.fuel,entertainment,healthcare';

export async function getNearbyPOIs(
  center: Coordinate,
  radiusMeters: number = 1500,
  categories?: string[],
): Promise<{ pois: POI[]; error: string | null }> {
  const cats = categories && categories.length > 0
    ? categories.join(',')
    : DEFAULT_CATEGORIES;

  // Check localStorage cache first
  const cacheK = poiCacheKey(center.lat, center.lng, cats);
  const cached = getCachedPOIs(cacheK);
  if (cached) {
    diagLog('cache HIT', { key: cacheK.slice(-30), pois: cached.length });
    for (const p of cached) p.distance = getDistance(center, p.coordinate);
    cached.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return { pois: cached, error: null };
  }

  try {
    const radius = Math.min(Math.round(radiusMeters), 5000);
    const limit = 80; // 4 credits per call — but 4× fewer tiles at z14 = net savings

    const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(cats)}&filter=circle:${center.lng},${center.lat},${radius}&bias=proximity:${center.lng},${center.lat}&limit=${limit}&lang=id&apiKey=${GEOAPIFY_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Geoapify ${res.status}: ${body || res.statusText}`);
    }

    const data = await res.json() as {
      features: Array<{
        properties: {
          place_id: string;
          name?: string;
          formatted?: string;
          categories?: string[];
          distance?: number;
          website?: string;
          phone?: string;
          opening_hours?: string;
          lat: number;
          lon: number;
        };
        geometry: { coordinates: [number, number] };
      }>;
    };

    const pois: POI[] = [];

    for (const feature of data.features) {
      const props = feature.properties;
      if (!props.name) continue; // skip unnamed POIs

      const coord: Coordinate = {
        lat: props.lat,
        lng: props.lon,
      };

      const dist = props.distance ?? getDistance(center, coord);

      // Extract categories — store full hierarchy paths, root, and subcategory
      const allCats = props.categories || [];
      const rootCat = allCats[0]?.split('.')[0] || 'place';
      const subCat = allCats[0]?.split('.').slice(0, 2).join('.') || rootCat;

      pois.push({
        id: `geo-${props.place_id}`,
        name: props.name,
        category: rootCat,
        subcategory: subCat,
        coordinate: coord,
        distance: dist,
        address: props.formatted,
        phone: props.phone,
        website: props.website,
        placeId: props.place_id,
        openState: props.opening_hours,
        types: allCats,
      });
    }

    pois.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    if (pois.length > 0) setCachedPOIs(cacheK, pois);

    return { pois, error: null };
  } catch (error) {
    console.error('POI fetch error:', error);
    return {
      pois: [],
      error: error instanceof Error ? error.message : 'Failed to fetch places',
    };
  }
}

// ─── Tap-to-identify fallback ────────────────────────────────────────
// Quick POI lookup at a specific point. Used when user taps a tile-rendered
// POI label that doesn't have a Breeva marker on top.

// ─── Rect-based fetch for tile coverage ──────────────────────────────

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function rectCacheKey(b: TileBounds, query: string): string {
  return `${POI_CACHE_PREFIX}r_${b.west.toFixed(3)}_${b.south.toFixed(3)}_${b.east.toFixed(3)}_${b.north.toFixed(3)}_${query.slice(0, 40)}`;
}

export async function getPOIsInRect(
  bounds: TileBounds,
  categories?: string[],
): Promise<{ pois: POI[]; error: string | null }> {
  const cats = categories && categories.length > 0
    ? categories.join(',')
    : DEFAULT_CATEGORIES;

  const cacheK = rectCacheKey(bounds, cats);
  const cached = getCachedPOIs(cacheK);
  if (cached) {
    diagLog('cache HIT', { key: cacheK.slice(-40), pois: cached.length });
    return { pois: cached, error: null };
  }

  try {
    const limit = 150;
    // Geoapify rect filter: lon1,lat1,lon2,lat2 (SW corner, NE corner)
    const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(cats)}&filter=rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}&limit=${limit}&lang=id&apiKey=${GEOAPIFY_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Geoapify ${res.status}: ${body || res.statusText}`);
    }

    const data = await res.json() as {
      features: Array<{
        properties: {
          place_id: string;
          name?: string;
          formatted?: string;
          categories?: string[];
          distance?: number;
          website?: string;
          phone?: string;
          opening_hours?: string;
          lat: number;
          lon: number;
        };
        geometry: { coordinates: [number, number] };
      }>;
    };

    const pois: POI[] = [];

    for (const feature of data.features) {
      const props = feature.properties;
      if (!props.name) continue;

      const coord: Coordinate = { lat: props.lat, lng: props.lon };
      const allCats = props.categories || [];
      const rootCat = allCats[0]?.split('.')[0] || 'place';
      const subCat = allCats[0]?.split('.').slice(0, 2).join('.') || rootCat;

      pois.push({
        id: `geo-${props.place_id}`,
        name: props.name,
        category: rootCat,
        subcategory: subCat,
        coordinate: coord,
        address: props.formatted,
        phone: props.phone,
        website: props.website,
        placeId: props.place_id,
        openState: props.opening_hours,
        types: allCats,
      });
    }

    if (pois.length > 0) setCachedPOIs(cacheK, pois);

    return { pois, error: null };
  } catch (error) {
    console.error('POI rect fetch error:', error);
    return {
      pois: [],
      error: error instanceof Error ? error.message : 'Failed to fetch places',
    };
  }
}

export async function getPlaceAtPoint(
  point: Coordinate,
): Promise<POI | null> {
  try {
    const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(DEFAULT_CATEGORIES)}&filter=circle:${point.lng},${point.lat},100&bias=proximity:${point.lng},${point.lat}&limit=3&lang=id&apiKey=${GEOAPIFY_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      features: Array<{
        properties: {
          place_id: string;
          name?: string;
          formatted?: string;
          categories?: string[];
          distance?: number;
          website?: string;
          phone?: string;
          opening_hours?: string;
          lat: number;
          lon: number;
        };
      }>;
    };
    for (const feature of data.features) {
      const props = feature.properties;
      if (!props.name) continue;
      const allCats = props.categories || [];
      const rootCat = allCats[0]?.split('.')[0] || 'place';
      const subCat = allCats[0]?.split('.').slice(0, 2).join('.') || rootCat;
      return {
        id: `geo-${props.place_id}`,
        name: props.name,
        category: rootCat,
        subcategory: subCat,
        coordinate: { lat: props.lat, lng: props.lon },
        address: props.formatted,
        phone: props.phone,
        website: props.website,
        placeId: props.place_id,
        openState: props.opening_hours,
        types: allCats,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Haversine distance ──────────────────────────────────────────────

function getDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371e3;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
