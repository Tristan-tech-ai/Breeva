/**
 * SearchAPI.io Client — Google Maps data via Vercel proxy
 * Endpoints: google_maps (search), google_maps_place (details),
 *            google_maps_reviews, google_maps_photos
 */
import type { Coordinate } from '../types';

const PROXY = '/api/searchapi';

// ─── Types ───────────────────────────────────────────────────────────

export interface GMapPlace {
  position?: number;
  place_id?: string;
  data_id?: string;
  title: string;
  description?: string;
  address?: string;
  phone?: string;
  rating?: number;
  reviews?: number;
  reviews_histogram?: Record<string, number>;
  website?: string;
  domain?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  type?: string;
  types?: string[];
  open_state?: string;
  hours?: string;
  open_hours?: Record<string, string>;
  price?: string;
  thumbnail?: string;
  images?: Array<{ title?: string; thumbnail: string } | string>;
}

export interface GMapPlaceDetail extends GMapPlace {
  ludocid?: string;
  kgmid?: string;
  plus_code?: string;
  extensions?: Array<{ title: string; items: Array<{ title: string; value: string }> }>;
  popular_times?: {
    live?: { info: string; typical_time_spent?: string };
    chart?: Record<string, Array<{ time: string; busyness_score: number; info?: string }>>;
  };
  review_results?: {
    summaries?: string[];
    reviews?: GMapReview[];
  };
  people_also_search_for?: Array<{
    title: string;
    data_id?: string;
    rating?: number;
    reviews?: number;
    types?: string[];
    thumbnail?: string;
    gps_coordinates?: { latitude: number; longitude: number };
  }>;
}

export interface GMapReview {
  review_id?: string;
  user?: {
    name: string;
    thumbnail?: string;
    is_local_guide?: boolean;
    reviews?: number;
    photos?: number;
  };
  rating: number;
  text?: string;
  snippet?: string;
  description?: string;
  date?: string;
  iso_date?: string;
  images?: Array<{ id?: string; image: string } | string>;
}

export interface GMapPhoto {
  image: string;
  thumbnail: string;
}

// ─── In-memory cache (avoids repeat API calls for same data) ─────────

const apiCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Low-level fetch ─────────────────────────────────────────────────

async function searchApi<T = Record<string, unknown>>(
  engine: string,
  params: Record<string, string>,
): Promise<T | null> {
  const url = new URL(PROXY, window.location.origin);
  url.searchParams.set('engine', engine);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const cacheKey = url.toString();
  const cached = apiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    apiCache.set(cacheKey, { data, ts: Date.now() });
    // Evict old entries when cache grows too large
    if (apiCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of apiCache) {
        if (now - v.ts > CACHE_TTL) apiCache.delete(k);
      }
    }
    return data;
  } catch {
    return null;
  }
}

// ─── Google Maps Search (nearby places) ──────────────────────────────

export async function searchGoogleMaps(
  query: string,
  location?: Coordinate,
  zoom = 14,
): Promise<GMapPlace[]> {
  const params: Record<string, string> = { q: query, hl: 'id' };
  if (location) {
    params.ll = `@${location.lat},${location.lng},${zoom}z`;
  }
  const data = await searchApi<{ local_results?: GMapPlace[] }>('google_maps', params);
  return data?.local_results || [];
}

// ─── Google Maps Place Details ───────────────────────────────────────

export async function getGooglePlaceDetails(
  placeId: string,
): Promise<GMapPlaceDetail | null> {
  const key = placeId.includes(':') ? 'data_id' : 'place_id';
  const data = await searchApi<{ place_result?: GMapPlaceDetail }>('google_maps_place', {
    [key]: placeId,
    hl: 'id',
  });
  // If single local_results returned (exact match), extract it
  if (!data?.place_result) {
    const alt = data as unknown as { local_results?: GMapPlaceDetail[] };
    if (alt?.local_results?.[0]) return alt.local_results[0];
  }
  return data?.place_result || null;
}

// ─── Google Maps Reviews ─────────────────────────────────────────────

export async function getGooglePlaceReviews(
  placeId: string,
  sortBy: 'most_relevant' | 'newest' | 'highest_rating' | 'lowest_rating' = 'most_relevant',
): Promise<{ reviews: GMapReview[]; place?: { title: string; rating: number; reviews: number } }> {
  const key = placeId.includes(':') ? 'data_id' : 'place_id';
  const data = await searchApi<{
    reviews?: GMapReview[];
    place_result?: { title: string; rating: number; reviews: number };
  }>('google_maps_reviews', { [key]: placeId, sort_by: sortBy, hl: 'id' });
  return {
    reviews: data?.reviews || [],
    place: data?.place_result || undefined,
  };
}

// ─── Google Maps Photos ──────────────────────────────────────────────

export async function getGooglePlacePhotos(
  placeId: string,
): Promise<GMapPhoto[]> {
  const key = placeId.includes(':') ? 'data_id' : 'place_id';
  const data = await searchApi<{ photos?: GMapPhoto[] }>('google_maps_photos', {
    [key]: placeId,
    hl: 'id',
  });
  return data?.photos || [];
}
