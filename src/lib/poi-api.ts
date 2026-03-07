import type { Coordinate } from '../types';
import { searchGoogleMaps } from './searchapi';

// Overpass API endpoint (public, no key needed)
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

export interface POI {
  id: string;
  name: string;
  category: string;
  coordinate: Coordinate;
  distance?: number; // meters from user
  address?: string;
  rating?: number;
  reviewCount?: number;
  phone?: string;
  website?: string;
  icon?: string;
  tags?: Record<string, string>; // OpenStreetMap tags
  isVerified?: boolean;
  placeId?: string;   // Google place_id
  dataId?: string;    // Google data_id
  thumbnail?: string;
  openState?: string; // e.g. "Open ⋅ Closes 10 PM"
  types?: string[];
  price?: string;
}

/**
 * Overpass API - Get nearby POIs from OpenStreetMap
 * Categories: cafe, restaurant, shop, park, etc.
 * Free, no API key required
 */
export async function getNearbyPOIsOverpass(
  center: Coordinate,
  radiusMeters: number = 1000,
  categories?: string[]
): Promise<{ pois: POI[]; error: string | null }> {
  try {
    // Default categories if none specified
    const osmTags = categories || [
      'amenity=cafe',
      'amenity=restaurant',
      'shop=supermarket',
      'shop=convenience',
      'shop=clothes',
      'shop=bookshop',
      'amenity=pharmacy',
      'leisure=park',
      'tourism=attraction',
    ];

    // Build Overpass QL query
    const tagQueries = osmTags.map((tag) => `node["${tag.split('=')[0]}"="${tag.split('=')[1]}"](around:${radiusMeters},${center.lat},${center.lng});`).join('');

    const query = `
      [out:json][timeout:10];
      (
        ${tagQueries}
      );
      out center;
    `;

    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const data = await response.json();

    const pois: POI[] = (data.elements || []).map((el: {
      id: number;
      lat: number;
      lon: number;
      tags: Record<string, string>;
    }) => {
      const category = el.tags.amenity || el.tags.shop || el.tags.leisure || el.tags.tourism || 'place';
      return {
        id: `osm-${el.id}`,
        name: el.tags.name || el.tags['name:en'] || `${category} (unnamed)`,
        category: category.charAt(0).toUpperCase() + category.slice(1),
        coordinate: { lat: el.lat, lng: el.lon },
        address: [el.tags['addr:street'], el.tags['addr:housenumber'], el.tags['addr:city']]
          .filter(Boolean)
          .join(', ') || undefined,
        phone: el.tags.phone || el.tags['contact:phone'],
        website: el.tags.website || el.tags['contact:website'],
        tags: el.tags,
      };
    });

    return { pois, error: null };
  } catch (error) {
    console.error('Overpass API error:', error);
    return {
      pois: [],
      error: error instanceof Error ? error.message : 'Failed to fetch POIs from OpenStreetMap',
    };
  }
}

/**
 * Google Maps via SearchAPI — Get nearby places with photos, ratings, reviews
 */
export async function getNearbyPOIsGoogle(
  center: Coordinate,
  radiusMeters: number = 1500,
  _categories?: string[]
): Promise<{ pois: POI[]; error: string | null }> {
  try {
    // Search for general "places" nearby, or use specific categories
    const queries = ['restoran kafe tempat menarik taman toko'];
    const allPlaces: POI[] = [];

    for (const q of queries) {
      const zoom = radiusMeters <= 500 ? 16 : radiusMeters <= 1000 ? 15 : 14;
      const results = await searchGoogleMaps(q, center, zoom);

      for (const place of results) {
        if (!place.gps_coordinates) continue;
        const coord: Coordinate = {
          lat: place.gps_coordinates.latitude,
          lng: place.gps_coordinates.longitude,
        };
        // Filter by radius
        const dist = getDistance(center, coord);
        if (dist > radiusMeters * 1.5) continue;

        allPlaces.push({
          id: place.place_id ? `gmap-${place.place_id}` : `gmap-${place.data_id || place.title}`,
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

    return { pois: allPlaces, error: null };
  } catch (error) {
    console.error('Google Maps SearchAPI error:', error);
    return {
      pois: [],
      error: error instanceof Error ? error.message : 'Failed to fetch from Google Maps',
    };
  }
}

/**
 * Get nearby POIs — tries Google Maps (SearchAPI) first, Overpass fallback
 */
export async function getNearbyPOIs(
  center: Coordinate,
  radiusMeters: number = 1000,
  categories?: string[]
): Promise<{ pois: POI[]; error: string | null }> {
  // Try Google Maps first (richer data)
  const googleResult = await getNearbyPOIsGoogle(center, radiusMeters, categories);

  // If Google returned results, use them as primary
  if (googleResult.pois.length > 0) {
    // Supplement with Overpass for extra coverage
    const overpassResult = await getNearbyPOIsOverpass(center, radiusMeters, categories).catch(() => ({
      pois: [] as POI[],
      error: null,
    }));

    const allPOIs = [...googleResult.pois, ...overpassResult.pois];

    // Deduplicate by name + proximity (50m)
    const deduplicated: POI[] = [];
    for (const poi of allPOIs) {
      const isDuplicate = deduplicated.some(
        (existing) =>
          existing.name.toLowerCase() === poi.name.toLowerCase() &&
          getDistance(existing.coordinate, poi.coordinate) < 50
      );
      if (!isDuplicate) {
        deduplicated.push(poi);
      }
    }

    deduplicated.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    return { pois: deduplicated, error: null };
  }

  // Fallback to Overpass only
  return getNearbyPOIsOverpass(center, radiusMeters, categories);
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function getDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const x = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
}
