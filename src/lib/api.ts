import type { Coordinate, AirQualityData, Route } from '../types';

// API Configuration
const ORS_API_KEY = import.meta.env.VITE_OPENROUTESERVICE_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

const ORS_BASE_URL = 'https://api.openrouteservice.org';

/**
 * OpenRouteService API - Get walking directions
 */
export async function getWalkingRoute(
  start: Coordinate,
  end: Coordinate,
  waypoints?: Coordinate[]
): Promise<{ route: Route | null; error: string | null }> {
  try {
    const coordinates = [
      [start.lng, start.lat],
      ...(waypoints?.map((wp) => [wp.lng, wp.lat]) || []),
      [end.lng, end.lat],
    ];

    const response = await fetch(`${ORS_BASE_URL}/v2/directions/foot-walking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates,
        format: 'geojson',
        instructions: true,
        units: 'm',
      }),
    });

    if (!response.ok) {
      throw new Error(`ORS API error: ${response.status}`);
    }

    const data = await response.json();
    const feature = data.features[0];
    const properties = feature.properties;
    const geometry = feature.geometry;

    // Convert GeoJSON coordinates to RoutePoints
    const routePoints = geometry.coordinates.map((coord: number[]) => ({
      lng: coord[0],
      lat: coord[1],
    }));

    return {
      route: {
        id: crypto.randomUUID(),
        user_id: '',
        start_point: start,
        end_point: end,
        waypoints: routePoints,
        distance_meters: properties.summary.distance,
        duration_seconds: properties.summary.duration,
        avg_aqi: 0, // Will be calculated separately
        eco_points_earned: 0,
        route_type: 'eco',
        created_at: new Date().toISOString(),
      },
      error: null,
    };
  } catch (error) {
    console.error('Failed to get walking route:', error);
    return {
      route: null,
      error: error instanceof Error ? error.message : 'Failed to get route',
    };
  }
}

/**
 * OpenRouteService API - Geocoding (search places)
 */
export async function searchPlaces(
  query: string,
  focusPoint?: Coordinate
): Promise<{ places: Array<{ name: string; coordinate: Coordinate }>; error: string | null }> {
  try {
    const params = new URLSearchParams({
      api_key: ORS_API_KEY,
      text: query,
      size: '5',
      layers: 'address,venue,street',
    });

    if (focusPoint) {
      params.append('focus.point.lat', focusPoint.lat.toString());
      params.append('focus.point.lon', focusPoint.lng.toString());
    }

    const response = await fetch(
      `${ORS_BASE_URL}/geocode/search?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Geocoding error: ${response.status}`);
    }

    const data = await response.json();
    const places = data.features.map((feature: { properties: { label: string }; geometry: { coordinates: number[] } }) => ({
      name: feature.properties.label,
      coordinate: {
        lat: feature.geometry.coordinates[1],
        lng: feature.geometry.coordinates[0],
      },
    }));

    return { places, error: null };
  } catch (error) {
    console.error('Failed to search places:', error);
    return {
      places: [],
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}

/**
 * OpenRouteService API - Reverse geocoding
 */
export async function reverseGeocode(
  coordinate: Coordinate
): Promise<{ address: string | null; error: string | null }> {
  try {
    const params = new URLSearchParams({
      api_key: ORS_API_KEY,
      'point.lat': coordinate.lat.toString(),
      'point.lon': coordinate.lng.toString(),
      size: '1',
    });

    const response = await fetch(
      `${ORS_BASE_URL}/geocode/reverse?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Reverse geocoding error: ${response.status}`);
    }

    const data = await response.json();
    const address = data.features[0]?.properties?.label || null;

    return { address, error: null };
  } catch (error) {
    console.error('Failed to reverse geocode:', error);
    return {
      address: null,
      error: error instanceof Error ? error.message : 'Geocoding failed',
    };
  }
}

/**
 * Fetch air quality data for a location
 * Using OpenWeatherMap Air Pollution API (free tier)
 */
export async function getAirQuality(
  coordinate: Coordinate
): Promise<{ data: AirQualityData | null; error: string | null }> {
  try {
    // Note: In production, use a proper AQI API
    // This is a placeholder that generates mock data
    const mockAQI = Math.floor(Math.random() * 150) + 20;
    
    const getLevel = (aqi: number) => {
      if (aqi <= 50) return 'good';
      if (aqi <= 100) return 'moderate';
      if (aqi <= 150) return 'unhealthy-sensitive';
      if (aqi <= 200) return 'unhealthy';
      if (aqi <= 300) return 'very-unhealthy';
      return 'hazardous';
    };

    return {
      data: {
        aqi: mockAQI,
        level: getLevel(mockAQI) as AirQualityData['level'],
        pm25: mockAQI * 0.5,
        pm10: mockAQI * 0.8,
        o3: mockAQI * 0.3,
        no2: mockAQI * 0.2,
        co: mockAQI * 0.1,
        so2: mockAQI * 0.1,
        timestamp: new Date().toISOString(),
        location: coordinate,
      },
      error: null,
    };
  } catch (error) {
    console.error('Failed to get air quality:', error);
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Failed to get AQI',
    };
  }
}

/**
 * Gemini AI - Generate eco-friendly route suggestions
 */
export async function getAIRouteSuggestion(
  start: string,
  destination: string,
  currentAQI: number
): Promise<{ suggestion: string | null; error: string | null }> {
  if (!GEMINI_API_KEY) {
    return { suggestion: null, error: 'Gemini API key not configured' };
  }

  try {
    const prompt = `You are an eco-friendly route advisor for a walking app called Breeva. 
    The user wants to walk from "${start}" to "${destination}".
    Current Air Quality Index (AQI) in the area is ${currentAQI}.
    
    Provide a brief (2-3 sentences) suggestion about:
    1. Whether it's a good time to walk based on AQI
    2. Any tips for the route (stay near parks, avoid traffic areas, etc.)
    
    Be encouraging and eco-positive in tone.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 150,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    return { suggestion, error: null };
  } catch (error) {
    console.error('Failed to get AI suggestion:', error);
    return {
      suggestion: null,
      error: error instanceof Error ? error.message : 'AI suggestion failed',
    };
  }
}
