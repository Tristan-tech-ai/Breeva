/**
 * VAYU Engine — Gaussian Dispersion Engine (Mode A, TypeScript)
 * CALINE3-inspired point-source approximation for Vercel serverless.
 * ERD Section 5.1, 5.3, 3.1 (Path A)
 */

import { createClient } from '@supabase/supabase-js';
import { getCulturalModifier } from './cultural-calendar';
import { withCircuitBreaker } from './circuit-breaker';

// -- Types --

interface RoadSegment {
  osm_way_id: number;
  highway: string;
  lanes: number | null;
  width: number | null;
  surface: string | null;
  maxspeed: number | null;
  landuse_proxy: string | null;
  canyon_ratio: number | null;
  traffic_base_estimate: number;
  traffic_calibration_factor: number;
  distance_m: number;
}

interface WeatherData {
  wind_speed: number;       // m/s
  wind_direction: number;   // degrees
  temperature: number;      // °C
  humidity: number;         // %
}

export interface DispersionResult {
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  co: number;
  o3: number;
  confidence: number;
  layer_source: number;
  region: string;
}

// -- Emission factors (g/km) ERD 5.1, Indonesia vehicle mix --
// Weighted average for Indonesia mixed fleet
const FLEET_EMISSION = {
  nox: 1.2,    // g/km weighted average
  pm25: 0.08,  // g/km weighted average
  co: 7.5,     // g/km weighted average
};

// -- Pasquill-Gifford dispersion coefficients (simplified) --
// Using stability class D (neutral) as default for tropical maritime climate
function sigmaY(x: number): number {
  // Class D: σy = 0.08 * x * (1 + 0.0001*x)^(-0.5)
  return 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5);
}

function sigmaZ(x: number): number {
  // Class D: σz = 0.06 * x * (1 + 0.0015*x)^(-0.5)
  return 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5);
}

// -- Landuse vegetation modifier --
const LANDUSE_MODIFIERS: Record<string, number> = {
  forest: 0.70,
  park: 0.80,
  meadow: 0.85,
  farmland: 0.90,
  residential: 1.00,
  commercial: 1.10,
  retail: 1.10,
  industrial: 1.25,
};

// -- Supabase client for serverless (service role) --
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key);
}

// -- Weather cache (1 hour, per grid cell ~0.1°) --
const weatherCache = new Map<string, { data: WeatherData; fetchedAt: number }>();
const WEATHER_CACHE_MS = 3600_000; // 1 hour

function weatherCacheKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`;
}

/** Fetch weather from Open-Meteo (free, no key needed) */
async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const key = weatherCacheKey(lat, lon);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) {
    return cached.data;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&timezone=auto`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
  const json = await resp.json();
  const c = json.current;

  const data: WeatherData = {
    wind_speed: c.wind_speed_10m ?? 2.0,
    wind_direction: c.wind_direction_10m ?? 0,
    temperature: c.temperature_2m ?? 28,
    humidity: c.relative_humidity_2m ?? 70,
  };

  weatherCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

/** Fetch AQI baseline from Open-Meteo Air Quality API */
async function fetchBaselineAQI(lat: number, lon: number): Promise<{
  pm25: number; pm10: number; no2: number; co: number; o3: number;
}> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&timezone=auto`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo AQ ${resp.status}`);
  const json = await resp.json();
  const c = json.current;

  return {
    pm25: c.pm2_5 ?? 15,
    pm10: c.pm10 ?? 25,
    no2: c.nitrogen_dioxide ?? 10,
    co: c.carbon_monoxide ?? 200,
    o3: c.ozone ?? 30,
  };
}

/** Find nearby road segments via Supabase RPC */
async function findNearbyRoads(
  lat: number,
  lon: number,
  radiusM: number = 500
): Promise<RoadSegment[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('find_nearby_roads', {
    lat, lon, radius_m: radiusM, max_results: 10,
  });
  if (error) throw new Error(`RPC find_nearby_roads: ${error.message}`);
  return (data || []) as RoadSegment[];
}

/**
 * Gaussian point-source dispersion concentration (μg/m³)
 * C = (Q / (π · σy · σz · u)) · exp(-y²/2σy²) · [exp(-(z-H)²/2σz²) + exp(-(z+H)²/2σz²)]
 *
 * Simplified: receptor at road level (y=0, z=0), so:
 * C = (Q / (π · σy · σz · u)) · 2·exp(-H²/2σz²)
 */
function gaussianConcentration(
  emissionRate: number, // g/m/s
  windSpeed: number,    // m/s
  distance: number,     // m (downwind from source)
  sourceHeight: number  // m (effective stack height: ~0.5 for road traffic)
): number {
  const u = Math.max(windSpeed, 0.5); // minimum 0.5 m/s to avoid division by zero
  const x = Math.max(distance, 10);   // minimum 10m
  const sy = sigmaY(x);
  const sz = sigmaZ(x);
  const H = sourceHeight;

  // g/m/s → μg/m/s (* 1e6)
  const Q = emissionRate * 1e6;

  const C = (Q / (Math.PI * sy * sz * u)) *
    2 * Math.exp(-(H * H) / (2 * sz * sz));

  return Math.max(0, C);
}

/**
 * Calculate traffic volume from road segment + time modifiers
 */
function estimateTrafficVolume(
  road: RoadSegment,
  culturalModifier: number
): number {
  const base = road.traffic_base_estimate || 100;
  const calibration = road.traffic_calibration_factor || 1.0;
  return Math.round(base * calibration * culturalModifier);
}

/**
 * Convert PM2.5 concentration (μg/m³) to US EPA AQI
 */
function pm25ToAQI(pm25: number): number {
  const breakpoints = [
    { lo: 0, hi: 12.0, aqiLo: 0, aqiHi: 50 },
    { lo: 12.1, hi: 35.4, aqiLo: 51, aqiHi: 100 },
    { lo: 35.5, hi: 55.4, aqiLo: 101, aqiHi: 150 },
    { lo: 55.5, hi: 150.4, aqiLo: 151, aqiHi: 200 },
    { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
    { lo: 250.5, hi: 500.4, aqiLo: 301, aqiHi: 500 },
  ];
  const c = Math.max(0, Math.min(pm25, 500.4));
  for (const bp of breakpoints) {
    if (c <= bp.hi) {
      return Math.round(
        ((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (c - bp.lo) + bp.aqiLo
      );
    }
  }
  return 500;
}

/**
 * Determine region from lat/lon (simple bounding box assignment)
 */
function detectRegion(lat: number, lon: number): string {
  if (lat >= -8.85 && lat <= -8.06 && lon >= 114.43 && lon <= 115.71) return 'bali';
  if (lat >= -6.50 && lat <= -6.08 && lon >= 106.60 && lon <= 107.10) return 'jakarta';
  if (lat >= -7.02 && lat <= -6.82 && lon >= 107.45 && lon <= 107.77) return 'bandung';
  if (lat >= -7.40 && lat <= -7.15 && lon >= 112.55 && lon <= 112.85) return 'surabaya';
  if (lat >= -7.10 && lat <= -6.90 && lon >= 110.30 && lon <= 110.50) return 'semarang';
  if (lat >= -7.87 && lat <= -7.72 && lon >= 110.30 && lon <= 110.50) return 'yogyakarta';
  if (lat >= -7.62 && lat <= -7.50 && lon >= 110.75 && lon <= 110.90) return 'solo';
  if (lat >= -8.05 && lat <= -7.90 && lon >= 112.58 && lon <= 112.68) return 'malang';
  if (lat >= -5.60 && lat <= -2.80 && lon >= 119.25 && lon <= 120.65) return 'sulsel';
  if (lat >= -3.60 && lat <= -1.40 && lon >= 118.70 && lon <= 119.45) return 'sulbar';
  if (lat >= -2.10 && lat <= 0.90 && lon >= 119.60 && lon <= 123.40) return 'sulteng';
  if (lat >= 0.20 && lat <= 0.95 && lon >= 121.80 && lon <= 123.15) return 'gorontalo';
  if (lat >= 0.30 && lat <= 1.65 && lon >= 123.20 && lon <= 125.30) return 'sulut';
  if (lat >= -5.55 && lat <= -3.00 && lon >= 121.30 && lon <= 124.10) return 'sultra';
  return 'unknown';
}

/**
 * Main dispersion computation for a single point.
 * Combines baseline (Open-Meteo) + road traffic dispersion delta + cultural modifiers.
 */
export async function computeDispersion(
  lat: number,
  lon: number,
  now?: Date
): Promise<DispersionResult> {
  const date = now || new Date();
  const region = detectRegion(lat, lon);

  // Fetch weather + baseline AQI (with circuit breaker)
  const { data: weather, degraded: weatherDegraded } =
    await withCircuitBreaker('open-meteo-weather', () => fetchWeather(lat, lon), {
      wind_speed: 2.0, wind_direction: 0, temperature: 28, humidity: 70,
    });

  const { data: baseline, degraded: baselineDegraded } =
    await withCircuitBreaker('open-meteo-airquality', () => fetchBaselineAQI(lat, lon), {
      pm25: 20, pm10: 30, no2: 15, co: 300, o3: 40,
    });

  // Find nearby roads (with circuit breaker)
  const { data: roads, degraded: roadsDegraded } =
    await withCircuitBreaker('supabase-roads', () => findNearbyRoads(lat, lon, 500), []);

  // Cultural + diurnal modifier
  const cultural = getCulturalModifier(date, region);

  // Compute dispersion delta from each nearby road
  let pm25Delta = 0;
  let no2Delta = 0;
  let coFraction = 0;

  for (const road of roads) {
    const trafficVol = estimateTrafficVolume(road, cultural.combined);
    const dist = Math.max(road.distance_m, 10);

    // Emission rate Q = traffic_volume * emission_factor / 3600 (vehicles/hr → vehicles/s)
    // Then per meter of road: Q_line ≈ Q * (1/avg_road_length_in_view)
    // Simplified: treat as point source with aggregated emission
    const qPM25 = (trafficVol * FLEET_EMISSION.pm25) / 3600; // g/s
    const qNOx = (trafficVol * FLEET_EMISSION.nox) / 3600;
    const qCO = (trafficVol * FLEET_EMISSION.co) / 3600;

    const cPM25 = gaussianConcentration(qPM25 / 1000, weather.wind_speed, dist, 0.5);
    const cNOx = gaussianConcentration(qNOx / 1000, weather.wind_speed, dist, 0.5);
    const cCO = gaussianConcentration(qCO / 1000, weather.wind_speed, dist, 0.5);

    // Landuse vegetation modifier
    const vegMod = LANDUSE_MODIFIERS[road.landuse_proxy || ''] ?? 1.0;

    // Canyon effect: higher canyon ratio = worse dispersion
    const canyonMod = 1.0 + (road.canyon_ratio || 0) * 0.3;

    pm25Delta += cPM25 * vegMod * canyonMod;
    no2Delta += cNOx * vegMod * canyonMod;
    coFraction += cCO * vegMod * canyonMod;
  }

  // Combine baseline + dispersion delta
  const pm25 = Math.max(0, baseline.pm25 + pm25Delta);
  const pm10 = Math.max(0, baseline.pm10 + pm25Delta * 1.5); // PM10 ≈ 1.5× PM2.5 delta
  const no2 = Math.max(0, baseline.no2 + no2Delta);
  const co = Math.max(0, baseline.co + coFraction);
  const o3 = baseline.o3; // O3 not significantly affected by local traffic

  const aqi = pm25ToAQI(pm25);

  // Confidence scoring
  let confidence = 0.35; // Mode A base confidence
  if (weatherDegraded) confidence -= 0.10;
  if (baselineDegraded) confidence -= 0.10;
  if (roadsDegraded || roads.length === 0) confidence -= 0.05;
  confidence = Math.max(0.10, confidence);

  return {
    aqi,
    pm25: Math.round(pm25 * 100) / 100,
    pm10: Math.round(pm10 * 100) / 100,
    no2: Math.round(no2 * 100) / 100,
    co: Math.round(co * 100) / 100,
    o3: Math.round(o3 * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    layer_source: 1, // Mode A = CALINE3-simplified
    region,
  };
}
