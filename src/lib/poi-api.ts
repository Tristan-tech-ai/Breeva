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
}

// ─── Google Maps via SearchAPI ───────────────────────────────────────

export async function getNearbyPOIs(
  center: Coordinate,
  radiusMeters: number = 1500,
  _categories?: string[],
): Promise<{ pois: POI[]; error: string | null }> {
  try {
    const zoom = radiusMeters <= 500 ? 16 : radiusMeters <= 1000 ? 15 : 14;

    const results = await searchGoogleMaps(
      'tempat menarik restoran kafe toko taman',
      center,
      zoom,
    );

    const pois: POI[] = [];
    const seen = new Set<string>();

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

    pois.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
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
