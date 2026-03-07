import type { Coordinate } from '../types';
import { searchGoogleMaps } from './searchapi';

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

// ─── Google Maps via SearchAPI ───────────────────────────────────────

export async function getNearbyPOIs(
  center: Coordinate,
  radiusMeters: number = 1500,
  searchQueries?: string[],
): Promise<{ pois: POI[]; error: string | null }> {
  const queries = searchQueries && searchQueries.length > 0
    ? searchQueries
    : ['tempat menarik restoran kafe toko taman masjid hotel'];

  // Check localStorage cache first
  const cacheK = poiCacheKey(center.lat, center.lng, queries.join('|'));
  const cached = getCachedPOIs(cacheK);
  if (cached) {
    // Recalculate distances from current center
    for (const p of cached) p.distance = getDistance(center, p.coordinate);
    cached.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return { pois: cached, error: null };
  }

  try {
    const zoom = radiusMeters <= 500 ? 16 : radiusMeters <= 1000 ? 15 : radiusMeters <= 3000 ? 14 : 13;

    const pois: POI[] = [];
    const seen = new Set<string>();

    const allResults = await Promise.all(
      queries.map(q => searchGoogleMaps(q, center, zoom)),
    );

    for (const results of allResults) {
      for (const place of results) {
        if (!place.gps_coordinates) continue;

        const coord: Coordinate = {
          lat: place.gps_coordinates.latitude,
          lng: place.gps_coordinates.longitude,
        };

        const dist = getDistance(center, coord);
        if (dist > radiusMeters * 1.5) continue;

        const key = place.place_id || place.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        pois.push({
          id: place.place_id ? `gmap-${place.place_id}` : `gmap-${place.data_id || String(Date.now())}`,
          name: place.title,
          category: place.type || place.types?.[0] || 'Place',
          coordinate: coord,
          distance: dist,
          address: place.address,
          rating: place.rating,
          reviewCount: place.reviews,
          phone: place.phone,
          website: place.website,
          thumbnail: place.thumbnail,
          placeId: place.place_id,
          dataId: place.data_id,
          openState: place.open_state || place.hours,
          types: place.types,
          price: place.price,
        });
      }
    }

    pois.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    // Persist to localStorage for future visits
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
