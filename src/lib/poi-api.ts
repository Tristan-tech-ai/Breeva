import type { Coordinate } from '../types';

const FOURSQUARE_API_KEY = import.meta.env.VITE_FOURSQUARE_API_KEY || '';

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
  phone?: string;
  website?: string;
  icon?: string;
  tags?: Record<string, string>; // OpenStreetMap tags
  isVerified?: boolean;
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
 * Foursquare Places API - Get nearby places with ratings, photos, and details
 * Requires API key (100k free calls/month)
 */
export async function getNearbyPOIsFoursquare(
  center: Coordinate,
  radiusMeters: number = 1000,
  categories?: string[]
): Promise<{ pois: POI[]; error: string | null }> {
  if (!FOURSQUARE_API_KEY || FOURSQUARE_API_KEY === 'YOUR_FOURSQUARE_API_KEY_HERE') {
    return {
      pois: [],
      error: 'Foursquare API key not configured. Sign up at https://location.foursquare.com/developer/',
    };
  }

  try {
    // Foursquare category IDs (subset)
    const categoryMap: Record<string, string> = {
      cafe: '13032',
      restaurant: '13065',
      shop: '17000',
      park: '16000',
      gym: '18021',
      pharmacy: '17084',
    };

    const categoryIds = categories?.map((c) => categoryMap[c] || '').filter(Boolean).join(',');

    const params = new URLSearchParams({
      ll: `${center.lat},${center.lng}`,
      radius: radiusMeters.toString(),
      limit: '50',
      ...(categoryIds && { categories: categoryIds }),
    });

    const response = await fetch(
      `https://api.foursquare.com/v3/places/search?${params.toString()}`,
      {
        headers: {
          Authorization: FOURSQUARE_API_KEY,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Foursquare API error: ${response.status}`);
    }

    const data = await response.json();

    const pois: POI[] = (data.results || []).map((place: {
      fsq_id: string;
      name: string;
      location: { address?: string; formatted_address?: string };
      geocodes: { main: { latitude: number; longitude: number } };
      categories: Array<{ name: string; icon: { prefix: string; suffix: string } }>;
      distance?: number;
      rating?: number;
      tel?: string;
      website?: string;
      verified?: boolean;
    }) => ({
      id: `fsq-${place.fsq_id}`,
      name: place.name,
      category: place.categories?.[0]?.name || 'Place',
      coordinate: {
        lat: place.geocodes.main.latitude,
        lng: place.geocodes.main.longitude,
      },
      address: place.location.formatted_address || place.location.address,
      distance: place.distance,
      rating: place.rating ? place.rating / 2 : undefined, // FSQ is 0-10, normalize to 0-5
      phone: place.tel,
      website: place.website,
      icon: place.categories?.[0]?.icon
        ? `${place.categories[0].icon.prefix}32${place.categories[0].icon.suffix}`
        : undefined,
      isVerified: place.verified,
    }));

    return { pois, error: null };
  } catch (error) {
    console.error('Foursquare API error:', error);
    return {
      pois: [],
      error: error instanceof Error ? error.message : 'Failed to fetch POIs from Foursquare',
    };
  }
}

/**
 * Get nearby POIs from both sources (merged and deduplicated)
 */
export async function getNearbyPOIs(
  center: Coordinate,
  radiusMeters: number = 1000,
  categories?: string[]
): Promise<{ pois: POI[]; error: string | null }> {
  // Fetch from both APIs in parallel
  const [overpassResult, foursquareResult] = await Promise.all([
    getNearbyPOIsOverpass(center, radiusMeters, categories),
    getNearbyPOIsFoursquare(center, radiusMeters, categories),
  ]);

  // Merge results
  const allPOIs = [...overpassResult.pois, ...foursquareResult.pois];

  // Simple deduplication: group by name and proximity (within 50m)
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

  // Sort by distance if available
  deduplicated.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const errors = [overpassResult.error, foursquareResult.error].filter(Boolean);
  return {
    pois: deduplicated,
    error: errors.length > 0 ? errors.join('; ') : null,
  };
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
