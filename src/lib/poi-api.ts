import type { Coordinate } from '../types';

const GEOAPIFY_KEY = '983da66a10e14f909057351679defe36';

export interface POI {
  id: string;
  name: string;
  category: string;
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
    for (const p of cached) p.distance = getDistance(center, p.coordinate);
    cached.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return { pois: cached, error: null };
  }

  try {
    const radius = Math.min(Math.round(radiusMeters), 5000);
    const limit = 100; // 1 credit per 20 results = 5 credits per call

    const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(cats)}&filter=circle:${center.lng},${center.lat},${radius}&bias=proximity:${center.lng},${center.lat}&limit=${limit}&lang=id&apiKey=${GEOAPIFY_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geoapify ${res.status}: ${res.statusText}`);

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

      // Extract primary category from Geoapify categories array
      const primaryCat = props.categories?.[0]?.split('.').pop() || 'place';
      const allTypes = props.categories?.map(c => c.split('.').pop() || c) || [];

      pois.push({
        id: `geo-${props.place_id}`,
        name: props.name,
        category: primaryCat,
        coordinate: coord,
        distance: dist,
        address: props.formatted,
        phone: props.phone,
        website: props.website,
        placeId: props.place_id,
        openState: props.opening_hours,
        types: allTypes,
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
      const primaryCat = props.categories?.[0]?.split('.').pop() || 'place';
      const allTypes = props.categories?.map(c => c.split('.').pop() || c) || [];
      return {
        id: `geo-${props.place_id}`,
        name: props.name,
        category: primaryCat,
        coordinate: { lat: props.lat, lng: props.lon },
        address: props.formatted,
        phone: props.phone,
        website: props.website,
        placeId: props.place_id,
        openState: props.opening_hours,
        types: allTypes,
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
