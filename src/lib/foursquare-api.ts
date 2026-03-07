/**
 * Foursquare Places API v3 Service
 * Autocomplete, search, place details, photos, category helpers.
 * Free tier: 100,000 calls/month — no billing required.
 */
import type { Coordinate } from '../types';

const API_KEY = import.meta.env.VITE_FOURSQUARE_API_KEY || '';
const BASE = 'https://api.foursquare.com/v3';

const fsqHeaders = (): HeadersInit => ({
  Authorization: API_KEY,
  Accept: 'application/json',
});

// ─── Types ───────────────────────────────────────────────────────────

export interface FSQCategory {
  id: number;
  name: string;
  short_name: string;
  icon: { prefix: string; suffix: string };
}

export interface FSQPhoto {
  id: string;
  prefix: string;
  suffix: string;
  width: number;
  height: number;
}

export interface FSQTip {
  id: string;
  text: string;
  created_at: string;
  agree_count?: number;
}

export interface FSQHours {
  display: string;
  open_now: boolean;
  regular?: { close: string; day: number; open: string }[];
}

export interface FSQPlace {
  fsq_id: string;
  name: string;
  categories: FSQCategory[];
  location: {
    address?: string;
    formatted_address?: string;
    locality?: string;
    region?: string;
    country?: string;
    neighborhood?: string[];
  };
  geocodes: { main: { latitude: number; longitude: number } };
  distance?: number;
  rating?: number;
  price?: number;
  hours?: FSQHours;
  tel?: string;
  website?: string;
  email?: string;
  description?: string;
  photos?: FSQPhoto[];
  tips?: FSQTip[];
  verified?: boolean;
  stats?: { total_photos: number; total_ratings: number; total_tips: number };
}

export interface FSQAutocompleteResult {
  type: 'place' | 'search' | 'geo';
  text: { primary: string; secondary?: string };
  place?: {
    fsq_id: string;
    name: string;
    categories: FSQCategory[];
    geocodes: { main: { latitude: number; longitude: number } };
    location: { formatted_address?: string; address?: string };
    distance?: number;
  };
}

// ─── API Functions ───────────────────────────────────────────────────

export async function fsqAutocomplete(
  query: string,
  location?: Coordinate,
): Promise<FSQAutocompleteResult[]> {
  if (!query.trim() || !API_KEY) return [];
  const params = new URLSearchParams({ query, limit: '8', types: 'place' });
  if (location) {
    params.set('ll', `${location.lat},${location.lng}`);
    params.set('radius', '50000');
  }
  try {
    const res = await fetch(`${BASE}/autocomplete?${params}`, { headers: fsqHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function fsqSearch(
  query: string,
  location?: Coordinate,
  limit = 10,
): Promise<FSQPlace[]> {
  if (!query.trim() || !API_KEY) return [];
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: 'fsq_id,name,categories,location,geocodes,distance,rating,price,hours,tel,website,photos,verified',
  });
  if (location) {
    params.set('ll', `${location.lat},${location.lng}`);
    params.set('radius', '50000');
  }
  try {
    const res = await fetch(`${BASE}/places/search?${params}`, { headers: fsqHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function fsqPlaceDetails(fsqId: string): Promise<FSQPlace | null> {
  if (!fsqId || !API_KEY) return null;
  const fields =
    'fsq_id,name,categories,location,geocodes,rating,price,hours,tel,website,email,description,photos,tips,verified,stats';
  try {
    const res = await fetch(
      `${BASE}/places/${encodeURIComponent(fsqId)}?fields=${fields}`,
      { headers: fsqHeaders() },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fsqPlacePhotos(fsqId: string, limit = 10): Promise<FSQPhoto[]> {
  if (!fsqId || !API_KEY) return [];
  try {
    const res = await fetch(
      `${BASE}/places/${encodeURIComponent(fsqId)}/photos?limit=${limit}&sort=POPULAR`,
      { headers: fsqHeaders() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function fsqPhotoUrl(photo: FSQPhoto, size = '400x300'): string {
  return `${photo.prefix}${size}${photo.suffix}`;
}

export function fsqCategoryIcon(cat: FSQCategory, size = 64): string {
  return `${cat.icon.prefix}${size}${cat.icon.suffix}`;
}

// ─── Category Style Map ──────────────────────────────────────────────

const CAT_STYLES: Record<string, { color: string; emoji: string }> = {
  restaurant: { color: '#f97316', emoji: '🍽️' },
  cafe: { color: '#92400e', emoji: '☕' },
  coffee: { color: '#92400e', emoji: '☕' },
  bakery: { color: '#d97706', emoji: '🍞' },
  bar: { color: '#7c3aed', emoji: '🍸' },
  fast: { color: '#ef4444', emoji: '🍔' },
  pizza: { color: '#ef4444', emoji: '🍕' },
  noodle: { color: '#f97316', emoji: '🍜' },
  seafood: { color: '#0ea5e9', emoji: '🦐' },
  park: { color: '#16a34a', emoji: '🌳' },
  garden: { color: '#16a34a', emoji: '🌿' },
  beach: { color: '#0ea5e9', emoji: '🏖️' },
  lake: { color: '#0ea5e9', emoji: '🏞️' },
  trail: { color: '#16a34a', emoji: '🥾' },
  shop: { color: '#eab308', emoji: '🛍️' },
  store: { color: '#eab308', emoji: '🛍️' },
  mall: { color: '#eab308', emoji: '🏬' },
  market: { color: '#eab308', emoji: '🛒' },
  supermarket: { color: '#22c55e', emoji: '🛒' },
  convenience: { color: '#22c55e', emoji: '🏪' },
  pharmacy: { color: '#ef4444', emoji: '💊' },
  hospital: { color: '#ef4444', emoji: '🏥' },
  clinic: { color: '#ef4444', emoji: '⚕️' },
  doctor: { color: '#ef4444', emoji: '👨‍⚕️' },
  hotel: { color: '#6366f1', emoji: '🏨' },
  hostel: { color: '#6366f1', emoji: '🛏️' },
  mosque: { color: '#10b981', emoji: '🕌' },
  church: { color: '#8b5cf6', emoji: '⛪' },
  temple: { color: '#d97706', emoji: '🛕' },
  school: { color: '#3b82f6', emoji: '🏫' },
  university: { color: '#3b82f6', emoji: '🎓' },
  gym: { color: '#14b8a6', emoji: '💪' },
  sport: { color: '#14b8a6', emoji: '⚽' },
  fitness: { color: '#14b8a6', emoji: '🏃' },
  bank: { color: '#6366f1', emoji: '🏦' },
  atm: { color: '#6366f1', emoji: '💳' },
  gas: { color: '#f59e0b', emoji: '⛽' },
  fuel: { color: '#f59e0b', emoji: '⛽' },
  station: { color: '#3b82f6', emoji: '🚉' },
  airport: { color: '#3b82f6', emoji: '✈️' },
  museum: { color: '#8b5cf6', emoji: '🏛️' },
  theater: { color: '#ec4899', emoji: '🎭' },
  cinema: { color: '#ec4899', emoji: '🎬' },
  library: { color: '#6366f1', emoji: '📚' },
  salon: { color: '#ec4899', emoji: '💇' },
  spa: { color: '#14b8a6', emoji: '🧖' },
  laundry: { color: '#6b7280', emoji: '👕' },
  parking: { color: '#6b7280', emoji: '🅿️' },
  police: { color: '#3b82f6', emoji: '🚔' },
  office: { color: '#6b7280', emoji: '🏢' },
  government: { color: '#0ea5e9', emoji: '🏛️' },
};

export function getCategoryStyle(categoryName: string): { color: string; emoji: string } {
  const lower = categoryName.toLowerCase();
  for (const [key, style] of Object.entries(CAT_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return { color: '#6b7280', emoji: '📍' };
}
