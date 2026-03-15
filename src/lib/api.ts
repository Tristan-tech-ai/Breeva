import type { Coordinate, AirQualityData, Route, RouteInstruction, TransportModeInfo, AQIFreshness, RouteScoreResult, ExposureResult, RoadAQIResponse, CleanRouteResponse } from '../types';

// API Configuration
const ORS_API_KEY = import.meta.env.VITE_OPENROUTESERVICE_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const ORS_BASE_URL = 'https://api.openrouteservice.org';

// Transport mode definitions
export const TRANSPORT_MODES: TransportModeInfo[] = [
  { id: 'walking', label: 'Walk', icon: 'Footprints', orsProfile: 'foot-walking', co2PerKm: 0, ecoPointsMultiplier: 1.5, speedFactor: 1, color: '#10b981' },
  { id: 'cycling', label: 'Cycle', icon: 'Bike', orsProfile: 'cycling-regular', co2PerKm: 0, ecoPointsMultiplier: 1.2, speedFactor: 3, color: '#0ea5e9' },
  { id: 'ebike', label: 'E-Bike', icon: 'Zap', orsProfile: 'cycling-electric', co2PerKm: 5, ecoPointsMultiplier: 1.0, speedFactor: 4, color: '#8b5cf6' },
  { id: 'motorcycle', label: 'Motor', icon: 'Bike', orsProfile: 'driving-car', co2PerKm: 100, ecoPointsMultiplier: 0.3, speedFactor: 8, color: '#f59e0b' },
  { id: 'car', label: 'Car', icon: 'Car', orsProfile: 'driving-car', co2PerKm: 170, ecoPointsMultiplier: 0, speedFactor: 10, color: '#ef4444' },
];

/**
 * OpenRouteService API - Get directions for any transport mode
 * Supports alternative_routes and avoid_features options.
 */
export async function getDirections(
  start: Coordinate,
  end: Coordinate,
  profile: string = 'foot-walking',
  waypoints?: Coordinate[],
  options?: {
    alternative_routes?: { share_factor?: number; target_count?: number; weight_factor?: number };
    avoid_features?: string[];
    preference?: 'fastest' | 'shortest' | 'recommended';
  }
): Promise<{ routes: Route[]; error: string | null }> {
  try {
    const coordinates = [
      [start.lng, start.lat],
      ...(waypoints?.map((wp) => [wp.lng, wp.lat]) || []),
      [end.lng, end.lat],
    ];

    const body: Record<string, unknown> = {
      coordinates,
      instructions: true,
      units: 'm',
    };

    if (options?.alternative_routes) {
      body.alternative_routes = options.alternative_routes;
    }
    if (options?.preference) {
      body.preference = options.preference;
    }
    if (options?.avoid_features && options.avoid_features.length > 0) {
      body.options = { avoid_features: options.avoid_features };
    }

    const response = await fetch(`${ORS_BASE_URL}/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`ORS API error: ${response.status} — ${errorBody}`);
    }

    const data = await response.json();
    const features = data?.features || [];
    if (features.length === 0) {
      throw new Error('No route found in ORS response');
    }

    const routes: Route[] = features.map((feature: { properties: { summary: { distance: number; duration: number }; segments: Array<{ steps: Array<{ instruction: string; distance: number; duration: number; type: number; way_points: number[] }> }> }; geometry: { coordinates: number[][] } }) => {
      const properties = feature.properties;
      const geometry = feature.geometry;

      const routePoints = geometry.coordinates.map((coord: number[]) => ({
        lng: coord[0],
        lat: coord[1],
      }));

      const instructions: RouteInstruction[] = (properties.segments || []).flatMap(
        (segment: { steps: Array<{ instruction: string; distance: number; duration: number; type: number; way_points: number[] }> }) =>
          (segment.steps || []).map((step: { instruction: string; distance: number; duration: number; type: number; way_points: number[] }) => ({
            text: step.instruction,
            distance: step.distance,
            duration: step.duration,
            type: step.type,
            waypoint_index: step.way_points?.[0] || 0,
          }))
      );

      return {
        id: crypto.randomUUID(),
        user_id: '',
        start_point: start,
        end_point: end,
        waypoints: routePoints,
        instructions,
        distance_meters: properties.summary.distance,
        duration_seconds: properties.summary.duration,
        avg_aqi: 0,
        eco_points_earned: 0,
        route_type: 'eco' as const,
        created_at: new Date().toISOString(),
      };
    });

    return { routes, error: null };
  } catch (error) {
    console.error('Failed to get route:', error);
    return {
      routes: [],
      error: error instanceof Error ? error.message : 'Failed to get route',
    };
  }
}

/** Backward-compatible wrapper for walking routes (returns first route) */
export async function getWalkingRoute(
  start: Coordinate,
  end: Coordinate,
  waypoints?: Coordinate[]
): Promise<{ route: Route | null; error: string | null }> {
  const result = await getDirections(start, end, 'foot-walking', waypoints);
  return { route: result.routes[0] || null, error: result.error };
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

// Simple in-memory AQI cache: key → { data, fetchedAt }
const aqiCache = new Map<string, { data: AirQualityData; fetchedAt: number }>();
const AQI_CACHE_TTL = 10 * 60 * 1000; // 10-minute TTL

function aqiCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function getAQILevel(aqi: number): AirQualityData['level'] {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy-sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

/** Simple PM2.5 → US EPA AQI conversion for fallback path */
function pm25ToAQISimple(pm25: number): number {
  const bp = [
    [0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
  ];
  const c = Math.max(0, Math.min(pm25, 500.4));
  for (const [lo, hi, aqiLo, aqiHi] of bp) {
    if (c <= hi) return Math.round(((aqiHi - aqiLo) / (hi - lo)) * (c - lo) + aqiLo);
  }
  return 500;
}

/**
 * Fetch air quality data via VAYU Engine API.
 * Uses H3 tile-based caching with Gaussian dispersion model.
 * Falls back to Open-Meteo direct baseline if VAYU endpoint fails.
 */
export async function getAirQuality(
  coordinate: Coordinate
): Promise<{ data: AirQualityData | null; error: string | null }> {
  try {
    const key = aqiCacheKey(coordinate.lat, coordinate.lng);
    const cached = aqiCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < AQI_CACHE_TTL) {
      return { data: cached.data, error: null };
    }

    const resp = await fetch(
      `/api/vayu/aqi?lat=${coordinate.lat}&lon=${coordinate.lng}`
    );

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(`VAYU API error: ${resp.status} — ${errBody.detail || errBody.error || 'unknown'}`);
    }

    const json = await resp.json();
    const d = json.data;

    const aqi = Math.round(d.aqi ?? 0);

    const data: AirQualityData = {
      aqi,
      level: getAQILevel(aqi),
      pm25: d.pm25 ?? 0,
      pm10: d.pm10 ?? 0,
      o3: d.o3 ?? 0,
      no2: d.no2 ?? 0,
      co: d.co ?? 0,
      so2: 0,
      timestamp: d.computed_at || new Date().toISOString(),
      location: coordinate,
      confidence: d.confidence,
      freshness: d.freshness as AQIFreshness,
      layer_source: d.layer_source,
      tile_id: d.tile_id,
    };

    aqiCache.set(key, { data, fetchedAt: Date.now() });

    return { data, error: null };
  } catch (error) {
    console.error('VAYU API failed, trying Open-Meteo fallback:', error);

    // Fallback: fetch baseline AQI directly from Open-Meteo
    try {
      const fallbackResp = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coordinate.lat}&longitude=${coordinate.lng}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone,european_aqi&timezone=auto`
      );
      if (!fallbackResp.ok) throw new Error(`Open-Meteo ${fallbackResp.status}`);
      const fb = await fallbackResp.json();
      const c = fb.current;

      const pm25 = c.pm2_5 ?? 15;
      const aqi = pm25ToAQISimple(pm25);

      const data: AirQualityData = {
        aqi,
        level: getAQILevel(aqi),
        pm25,
        pm10: c.pm10 ?? 0,
        o3: c.ozone ?? 0,
        no2: c.nitrogen_dioxide ?? 0,
        co: c.carbon_monoxide ?? 0,
        so2: 0,
        timestamp: new Date().toISOString(),
        location: coordinate,
        confidence: 0.15,
        freshness: 'stale' as AQIFreshness,
        layer_source: 0,
        tile_id: undefined,
      };

      aqiCache.set(aqiCacheKey(coordinate.lat, coordinate.lng), { data, fetchedAt: Date.now() });
      return { data, error: null };
    } catch (fallbackError) {
      console.error('Open-Meteo fallback also failed:', fallbackError);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to get AQI',
      };
    }
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 256,
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

// ═══════════════════════════════════════════════════════════════
// Smart Route Analysis: Overpass, Road Data, AQI Estimation
// ═══════════════════════════════════════════════════════════════

/** Calculate Haversine distance between two coordinates in meters */
export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Check if a route's geometry is too similar to any route already in a pool.
 * Samples 5 evenly-spaced points from each route and compares average distance.
 */
export function routeGeometrySimilar(candidate: Route, pool: Route[], thresholdMeters = 80): boolean {
  if (pool.length === 0) return false;

  const sample = (wps: Coordinate[], n: number): Coordinate[] => {
    if (wps.length <= n) return [...wps];
    const s = (wps.length - 1) / (n - 1);
    return Array.from({ length: n }, (_, i) => wps[Math.round(i * s)]);
  };

  const candidateSamples = sample(candidate.waypoints, 5);

  return pool.some((existing) => {
    const existingSamples = sample(existing.waypoints, 5);
    const avgDist =
      candidateSamples.reduce(
        (sum, cp, i) => sum + haversineDistance(cp, existingSamples[i] || cp),
        0
      ) / candidateSamples.length;
    return avgDist < thresholdMeters;
  });
}

/** Road segment from Overpass */
export interface RoadSegment {
  center: Coordinate;
  highway: string;
  name?: string;
}

/** Combined environment data from a single Overpass query */
export interface AreaEnvironmentData {
  greenSpaces: Coordinate[];
  roads: RoadSegment[];
  pollutionSources: Coordinate[];  // industrial/commercial zones
  waterBodies: Coordinate[];       // rivers, lakes, streams
}

/**
 * Fetch green spaces AND road data in a single Overpass API call.
 * This is the key data source for route differentiation & AQI estimation.
 */
export async function getAreaEnvironmentData(
  start: Coordinate,
  end: Coordinate
): Promise<AreaEnvironmentData> {
  try {
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    const routeDistance = haversineDistance(start, end);
    const searchRadius = Math.min(Math.max(routeDistance * 0.6, 400), 2000);

    const south = Math.min(start.lat, end.lat) - 0.003;
    const west = Math.min(start.lng, end.lng) - 0.003;
    const north = Math.max(start.lat, end.lat) + 0.003;
    const east = Math.max(start.lng, end.lng) + 0.003;

    const query = `
[out:json][timeout:12];
(
  way["leisure"~"^(park|garden|playground|nature_reserve)$"](around:${searchRadius},${midLat},${midLng});
  relation["leisure"="park"](around:${searchRadius},${midLat},${midLng});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](around:${searchRadius},${midLat},${midLng});
  way["landuse"~"^(industrial|commercial)$"](around:${searchRadius},${midLat},${midLng});
  relation["landuse"~"^(industrial|commercial)$"](around:${searchRadius},${midLat},${midLng});
  way["natural"="water"](around:${searchRadius},${midLat},${midLng});
  way["waterway"~"^(river|stream|canal)$"](around:${searchRadius},${midLat},${midLng});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|footway|pedestrian|cycleway|path|living_street|service)$"](${south},${west},${north},${east});
);
out center tags;`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Overpass error: ${response.status}`);
    const data = await response.json();

    const mid: Coordinate = { lat: midLat, lng: midLng };
    const greenSpaces: Coordinate[] = [];
    const roads: RoadSegment[] = [];
    const pollutionSources: Coordinate[] = [];
    const waterBodies: Coordinate[] = [];

    for (const e of (data.elements || []) as Array<{ center?: { lat: number; lon: number }; tags?: Record<string, string> }>) {
      if (!e.center) continue;
      const coord: Coordinate = { lat: e.center.lat, lng: e.center.lon };

      // Green areas
      if (e.tags?.leisure || e.tags?.landuse === 'grass' || e.tags?.landuse === 'forest' || e.tags?.landuse === 'meadow' || e.tags?.landuse === 'recreation_ground') {
        greenSpaces.push(coord);
      }
      // Pollution sources — industrial zones, commercial areas
      if (e.tags?.landuse === 'industrial' || e.tags?.landuse === 'commercial') {
        pollutionSources.push(coord);
      }
      // Water bodies — rivers, lakes, streams (cleaner air corridors)
      if (e.tags?.natural === 'water' || e.tags?.waterway) {
        waterBodies.push(coord);
      }
      // Roads
      if (e.tags?.highway) {
        roads.push({ center: coord, highway: e.tags.highway, name: e.tags.name });
      }
    }

    // Sort green spaces by distance to midpoint
    greenSpaces.sort((a, b) => haversineDistance(a, mid) - haversineDistance(b, mid));

    return { greenSpaces, roads, pollutionSources, waterBodies };
  } catch (error) {
    console.warn('Overpass environment query failed, using fallback:', error);
    return { greenSpaces: [], roads: [], pollutionSources: [], waterBodies: [] };
  }
}

// Traffic weight by road type (higher = more car traffic/pollution)
const ROAD_TRAFFIC_WEIGHTS: Record<string, number> = {
  motorway: 100,
  trunk: 90,
  primary: 80,
  secondary: 65,
  tertiary: 50,
  residential: 30,
  living_street: 15,
  service: 20,
  cycleway: 5,
  footway: 3,
  pedestrian: 2,
  path: 2,
};

/** Full route environment analysis result */
export interface RouteEnvironment {
  trafficScore: number;       // 0-100 (100 = very heavy traffic)
  greenScore: number;         // 0-100 (100 = very green)
  estimatedAQI: number;       // locally adjusted AQI
  aqiFactors: string[];       // explanation factors
  roadBreakdown: { heavy: number; medium: number; light: number; pedestrian: number };
  nearbyParks: number;
  trafficLevel: 'low' | 'moderate' | 'high' | 'very-high';
  summary: string;
}

/**
 * Analyze a route's environmental characteristics.
 * Scores proximity to green spaces, pollution sources, water bodies, and road traffic.
 * Uses heuristic model to estimate local AQI variation from the regional sensor reading.
 */
export function analyzeRouteEnvironment(
  routeWaypoints: Coordinate[],
  roadSegments: RoadSegment[],
  greenSpaces: Coordinate[],
  pollutionSources: Coordinate[],
  waterBodies: Coordinate[],
  baseAQI: number
): RouteEnvironment {
  // Sample route waypoints (max 20 evenly-spaced) for performance
  const step = Math.max(1, Math.floor(routeWaypoints.length / 20));
  const sampledWaypoints = routeWaypoints.filter((_, i) => i % step === 0);

  // ── Nearby roads within 150m of route ──
  const nearbyRoads = roadSegments.filter((road) =>
    sampledWaypoints.some((wp) => haversineDistance(wp, road.center) < 150)
  );

  const breakdown = { heavy: 0, medium: 0, light: 0, pedestrian: 0 };
  for (const road of nearbyRoads) {
    const w = ROAD_TRAFFIC_WEIGHTS[road.highway] ?? 30;
    if (w >= 65) breakdown.heavy++;
    else if (w >= 30) breakdown.medium++;
    else if (w >= 10) breakdown.light++;
    else breakdown.pedestrian++;
  }

  const totalRoads = Math.max(1, nearbyRoads.length);

  // Traffic score: weighted average
  const rawTrafficScore =
    nearbyRoads.reduce((sum, road) => sum + (ROAD_TRAFFIC_WEIGHTS[road.highway] ?? 30), 0) / totalRoads;
  const trafficScore = Math.min(100, Math.round(rawTrafficScore));

  // ── Green features near route ──
  const nearbyParks = greenSpaces.filter((park) =>
    sampledWaypoints.some((wp) => haversineDistance(wp, park) < 300)
  ).length;

  // ── Pollution sources near route (industrial, commercial zones) ──
  const nearbyPollution = pollutionSources.filter((src) =>
    sampledWaypoints.some((wp) => haversineDistance(wp, src) < 400)
  ).length;

  // ── Water bodies near route (rivers, lakes — cleaner air corridors) ──
  const nearbyWater = waterBodies.filter((wb) =>
    sampledWaypoints.some((wp) => haversineDistance(wp, wb) < 300)
  ).length;

  // ── Green score calculation ──
  const pedestrianRatio = (breakdown.pedestrian + breakdown.light) / totalRoads;
  const greenScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        nearbyParks * 18 +
        nearbyWater * 12 +
        pedestrianRatio * 50 -
        nearbyPollution * 15 -
        breakdown.heavy * 5
      )
    )
  );

  // ══════════ AQI Estimation Heuristics ══════════
  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isRushHour = isWeekday && ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19));
  const isMorningRush = isWeekday && hour >= 7 && hour <= 9;

  let aqiMultiplier = 1.0;
  const factors: string[] = [];

  // Heavy traffic roads increase pollution
  if (breakdown.heavy >= 3) {
    aqiMultiplier += 0.28;
    factors.push('Major roads nearby (+28%)');
  } else if (breakdown.heavy >= 1) {
    aqiMultiplier += 0.14;
    factors.push('Some main roads (+14%)');
  }

  // Industrial/commercial zones
  if (nearbyPollution >= 2) {
    aqiMultiplier += 0.22;
    factors.push('Industrial/commercial area (+22%)');
  } else if (nearbyPollution === 1) {
    aqiMultiplier += 0.10;
    factors.push('Near commercial zone (+10%)');
  }

  // Parks & green areas filter pollution
  if (nearbyParks >= 3) {
    aqiMultiplier -= 0.20;
    factors.push('Green corridor (-20%)');
  } else if (nearbyParks >= 1) {
    aqiMultiplier -= 0.12;
    factors.push('Near green areas (-12%)');
  }

  // Water bodies — riverside/lakeside cleaner air
  if (nearbyWater >= 2) {
    aqiMultiplier -= 0.14;
    factors.push('Along waterways (-14%)');
  } else if (nearbyWater >= 1) {
    aqiMultiplier -= 0.08;
    factors.push('Near water (-8%)');
  }

  // Pedestrian-only paths = less vehicle exposure
  if (pedestrianRatio > 0.6) {
    aqiMultiplier -= 0.14;
    factors.push('Mostly pedestrian paths (-14%)');
  } else if (pedestrianRatio > 0.3) {
    aqiMultiplier -= 0.06;
    factors.push('Some pedestrian paths (-6%)');
  }

  // Rush hour on main roads
  if (isRushHour && breakdown.heavy >= 1) {
    aqiMultiplier += 0.20;
    factors.push('Rush hour traffic (+20%)');
  } else if (isMorningRush) {
    aqiMultiplier += 0.08;
    factors.push('Morning commute (+8%)');
  }

  // Weekend bonus
  if (!isWeekday && breakdown.heavy < 3) {
    aqiMultiplier -= 0.06;
    factors.push('Weekend, less traffic (-6%)');
  }

  const estimatedAQI = Math.max(5, Math.round(baseAQI * aqiMultiplier));

  // Traffic level label
  let trafficLevel: RouteEnvironment['trafficLevel'];
  if (trafficScore < 20) trafficLevel = 'low';
  else if (trafficScore < 45) trafficLevel = 'moderate';
  else if (trafficScore < 70) trafficLevel = 'high';
  else trafficLevel = 'very-high';

  // ── Human-readable summary ──
  let summary: string;
  if (nearbyParks >= 2 && nearbyWater >= 1) summary = 'Through parks along waterway';
  else if (nearbyParks >= 2) summary = 'Through parks and green areas';
  else if (nearbyWater >= 2) summary = 'Along river/waterfront';
  else if (nearbyParks === 1 && breakdown.pedestrian > breakdown.heavy) summary = 'Near park, quiet streets';
  else if (nearbyWater === 1 && breakdown.heavy === 0) summary = 'Near waterway, calm area';
  else if (breakdown.pedestrian > totalRoads * 0.5) summary = 'Pedestrian-friendly paths';
  else if (nearbyPollution >= 2) summary = 'Through commercial/industrial area';
  else if (breakdown.heavy >= 3) summary = 'Along major roads, heavy traffic';
  else if (breakdown.heavy >= 1) summary = 'Mixed roads, some traffic';
  else summary = 'Residential streets';

  return {
    trafficScore,
    greenScore,
    estimatedAQI,
    aqiFactors: factors,
    roadBreakdown: breakdown,
    nearbyParks,
    trafficLevel,
    summary,
  };
}

/**
 * Pick the best green space waypoint for eco routing.
 * Selects a park that creates a meaningful detour from the direct path.
 */
export function pickEcoWaypoint(
  start: Coordinate,
  end: Coordinate,
  greenSpaces: Coordinate[]
): Coordinate | null {
  if (greenSpaces.length === 0) return null;

  const directDist = haversineDistance(start, end);

  // Prefer a park that adds a 5-50% detour (meaningful but not excessive)
  for (const park of greenSpaces) {
    const detourDist = haversineDistance(start, park) + haversineDistance(park, end);
    const detourRatio = detourDist / directDist;
    if (detourRatio > 1.05 && detourRatio < 1.50) {
      return park;
    }
  }

  // If no ideal detour park, use the closest park if it adds at least some variation
  const closest = greenSpaces[0];
  const closestDetour = haversineDistance(start, closest) + haversineDistance(closest, end);
  if (closestDetour / directDist < 2.0) {
    return closest;
  }

  return null;
}

/**
 * Generate a perpendicular offset point to force a different route geometry.
 * Used as fallback when no green spaces are found.
 */
export function getPerpendicularWaypoint(
  start: Coordinate,
  end: Coordinate,
  offsetMeters: number
): Coordinate {
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;

  const dLat = end.lat - start.lat;
  const dLng = end.lng - start.lng;

  // Perpendicular direction (rotate 90°)
  const perpLat = -dLng;
  const perpLng = dLat;

  const len = Math.sqrt(perpLat * perpLat + perpLng * perpLng);
  if (len === 0) return { lat: midLat + 0.001, lng: midLng };

  // Convert meters to approximate degrees
  const degPerMeter = 1 / 111320;
  const offsetDeg = offsetMeters * degPerMeter;

  return {
    lat: midLat + (perpLat / len) * offsetDeg,
    lng: midLng + (perpLng / len) * offsetDeg,
  };
}

/**
 * Use Gemini LLM to refine AQI estimates based on environmental context.
 * Falls back to null if unavailable (caller uses heuristic estimates).
 *
 * This predicts local micro-AQI variation that sensors can't capture:
 * - Vehicle density near major roads vs parks
 * - Time-of-day traffic patterns
 * - Vegetation filtering effects
 */
export async function refineAQIWithGemini(
  routes: Array<{
    routeType: string;
    environment: RouteEnvironment;
    distanceKm: number;
  }>,
  baseAQI: number,
  location: Coordinate
): Promise<number[] | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const hour = new Date().getHours();
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

    const routeLines = routes
      .map((r, i) => {
        const env = r.environment;
        return `Route ${i + 1} (${r.routeType}, ${r.distanceKm.toFixed(1)}km):
- Heavy traffic roads: ${env.roadBreakdown.heavy}, Medium: ${env.roadBreakdown.medium}, Light: ${env.roadBreakdown.light}, Pedestrian: ${env.roadBreakdown.pedestrian}
- Parks within 300m: ${env.nearbyParks}
- Traffic score: ${env.trafficScore}/100`;
      })
      .join('\n');

    const prompt = `Estimate LOCAL AQI (US EPA scale) for ${routes.length} walking routes.

Location: ${location.lat.toFixed(4)}\u00b0, ${location.lng.toFixed(4)}\u00b0
Time: ${String(hour).padStart(2, '0')}:00, ${dayName}
Regional sensor AQI: ${baseAQI}

${routeLines}

Scientific adjustment factors:
- Primary/trunk roads: PM2.5 +20-50% within 100m of traffic
- Parks/vegetation: 10-25% better air (leaf filtration)
- Pedestrian zones: 10-20% lower NO2/PM2.5
- Rush hours (7-9AM, 5-7PM weekday): +15-30% on main roads
- Weekend: ~15% less traffic emissions

Return ONLY a JSON array of ${routes.length} integers: [aqi1, aqi2${routes.length > 2 ? ', aqi3' : ''}]`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 128, temperature: 0.1 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Gemini ${response.status}`);

    const data = await response.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON array from response
    const match = text.match(/\[\s*\d[\d\s,]*\]/);
    if (match) {
      const aqis: number[] = JSON.parse(match[0]);
      if (Array.isArray(aqis) && aqis.length === routes.length && aqis.every((n) => typeof n === 'number' && n > 0 && n < 500)) {
        return aqis;
      }
    }

    return null;
  } catch (error) {
    console.warn('Gemini AQI refinement unavailable:', error);
    return null;
  }
}

/** Waypoint plan from Gemini for 3 different route strategies */
export interface GeminiRoutePlan {
  fastest: Coordinate[];   // waypoints along main roads for speed
  cleanest: Coordinate[];  // waypoints through parks, water, pedestrian areas
  balanced: Coordinate[];  // mix of both
}

/**
 * Ask Gemini to analyze the local area and plan 3 genuinely different route
 * waypoint strategies based on Overpass environment data.
 *
 * This is the key innovation: Gemini acts as a "local knowledge brain" that
 * picks specific streets/areas to route through, creating routes that are
 * truly different — not just the same path scored differently.
 */
export async function planRouteWaypoints(
  start: Coordinate,
  end: Coordinate,
  envData: AreaEnvironmentData,
  baseAQI: number
): Promise<GeminiRoutePlan | null> {
  if (!GEMINI_API_KEY) return null;

  const hour = new Date().getHours();
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];

  // Format environment data for Gemini
  const greenList = envData.greenSpaces.slice(0, 10)
    .map((g, i) => `  G${i + 1}: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`)
    .join('\n');
  const waterList = envData.waterBodies.slice(0, 6)
    .map((w, i) => `  W${i + 1}: ${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`)
    .join('\n');
  const pollutionList = envData.pollutionSources.slice(0, 6)
    .map((p, i) => `  P${i + 1}: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)
    .join('\n');

  // Group roads by type for a compact summary
  const roadsByType: Record<string, Array<{ name?: string; lat: string; lng: string }>> = {};
  for (const road of envData.roads.slice(0, 40)) {
    const type = road.highway;
    if (!roadsByType[type]) roadsByType[type] = [];
    roadsByType[type].push({
      name: road.name,
      lat: road.center.lat.toFixed(5),
      lng: road.center.lng.toFixed(5),
    });
  }
  const roadSummary = Object.entries(roadsByType)
    .map(([type, segs]) => {
      const named = segs.filter((s) => s.name).slice(0, 3);
      const namedStr = named.length > 0
        ? named.map((s) => `${s.name} (${s.lat},${s.lng})`).join('; ')
        : segs.slice(0, 2).map((s) => `(${s.lat},${s.lng})`).join('; ');
      return `  ${type} (${segs.length}x): ${namedStr}`;
    })
    .join('\n');

  const prompt = `You are a routing expert. Given start/end coordinates and nearby environment data, suggest intermediate waypoints for 3 different walking route strategies.

START: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}
END: ${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}
TIME: ${String(hour).padStart(2, '0')}:00 ${dayName}
BASE AQI: ${baseAQI}

NEARBY GREEN SPACES (parks, gardens):
${greenList || '  (none found)'}

WATER BODIES (rivers, lakes):
${waterList || '  (none found)'}

POLLUTION SOURCES (industrial/commercial):
${pollutionList || '  (none found)'}

ROAD NETWORK:
${roadSummary || '  (limited data)'}

TASK: Pick 1-2 intermediate waypoint coordinates for each strategy. Each waypoint must be near (within 500m of) the features listed above. The 3 strategies must produce NOTICEABLY DIFFERENT paths:

1. FASTEST: Route via main/wide roads (primary, secondary, tertiary). Pick waypoints along the most direct major road corridor. Minimize distance.
2. CLEANEST: Route AWAY from traffic. Pick waypoints near parks, green spaces, waterways, pedestrian streets. AVOID main roads and pollution sources. Maximize air quality.
3. BALANCED: A middle ground. Some main roads but also passing green areas when convenient.

IMPORTANT:
- Each route's waypoints should pull the path in a DIFFERENT geographic direction
- If no green spaces exist, use residential/pedestrian streets for cleanest
- If no main roads exist, use the most direct path for fastest
- Waypoints must be BETWEEN start and end, not beyond them
- Return coordinates with 5 decimal places

Return ONLY valid JSON, no other text:
{"fastest":[[lat,lng]],"cleanest":[[lat,lng],[lat,lng]],"balanced":[[lat,lng]]}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.3 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Gemini ${response.status}`);

    const data = await response.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      fastest?: number[][];
      cleanest?: number[][];
      balanced?: number[][];
    };

    const toCoords = (arr?: number[][]): Coordinate[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
        .map((p) => ({ lat: p[0], lng: p[1] }));
    };

    const plan: GeminiRoutePlan = {
      fastest: toCoords(parsed.fastest),
      cleanest: toCoords(parsed.cleanest),
      balanced: toCoords(parsed.balanced),
    };

    // Validate: at least one strategy should have waypoints
    if (plan.fastest.length === 0 && plan.cleanest.length === 0 && plan.balanced.length === 0) {
      return null;
    }

    return plan;
  } catch (error) {
    console.warn('Gemini route planning unavailable:', error);
    return null;
  }
}

// ── VAYU Engine API helpers ──

/** Map Breeva transport modes to VAYU vehicle_type enum */
const VEHICLE_TYPE_MAP: Record<string, string> = {
  walking: 'pedestrian',
  cycling: 'cyclist',
  ebike: 'cyclist',
  motorcycle: 'motorcycle_open',
  car: 'car_window_open',
};

export function getVayuVehicleType(transportMode: string): string {
  return VEHICLE_TYPE_MAP[transportMode] || 'pedestrian';
}

/** Get VAYU route score for a polyline */
export async function getVayuRouteScore(
  polyline: [number, number][],
  vehicleType: string,
  durationSeconds?: number
): Promise<RouteScoreResult | null> {
  try {
    const resp = await fetch('/api/vayu/route-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        polyline,
        vehicle_type: vehicleType,
        duration_seconds: durationSeconds,
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.data as RouteScoreResult;
  } catch {
    return null;
  }
}

/** Get VAYU cumulative exposure after a walk/ride */
export async function getVayuExposure(
  polyline: [number, number][],
  vehicleType: string,
  durationMinutes: number
): Promise<ExposureResult | null> {
  try {
    const resp = await fetch('/api/vayu/exposure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        polyline,
        vehicle_type: vehicleType,
        duration_minutes: durationMinutes,
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.data as ExposureResult;
  } catch {
    return null;
  }
}

/** Submit a crowdsource contribution to VAYU */
export async function submitVayuContribution(
  sessionId: string,
  vehicleType: string,
  osmWayId?: number
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      session_id: sessionId,
      vehicle_type: vehicleType,
    };
    if (osmWayId) {
      body.osm_way_id = osmWayId;
    } else {
      body.is_off_road = true;
      body.off_road_geohash = 'unknown';
    }

    const resp = await fetch('/api/vayu/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return resp.ok || resp.status === 201;
  } catch {
    return false;
  }
}

/** Fetch road-level AQI data for a map viewport bounding box */
export async function getRoadAQI(
  south: number,
  west: number,
  north: number,
  east: number,
  zoom: number,
  forecastHour = 0
): Promise<RoadAQIResponse | null> {
  try {
    const params = new URLSearchParams({
      south: south.toFixed(6),
      west: west.toFixed(6),
      north: north.toFixed(6),
      east: east.toFixed(6),
      zoom: String(Math.round(zoom)),
    });
    if (forecastHour > 0) params.set('forecast_hour', String(forecastHour));
    const resp = await fetch(`/api/vayu/road-aqi?${params}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Call VAYU clean-route endpoint for AQI-scored alternative routes */
export async function getCleanRoute(
  start: [number, number],
  end: [number, number],
  profile: string,
  alternatives: number = 3
): Promise<CleanRouteResponse> {
  try {
    const resp = await fetch('/api/vayu/route-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end, profile, alternatives }),
    });
    if (!resp.ok) return { routes: [], meta: { vayu_scored: false, gemini_used: false, response_ms: 0 } };
    return await resp.json();
  } catch {
    return { routes: [], meta: { vayu_scored: false, gemini_used: false, response_ms: 0 } };
  }
}
