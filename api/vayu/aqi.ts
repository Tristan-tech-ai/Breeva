import type { VercelRequest, VercelResponse } from '@vercel/node';
import { latLngToCell } from 'h3-js';

/**
 * VAYU AQI Endpoint — Self-contained serverless function.
 * All logic inlined to avoid cross-directory import failures on Vercel.
 *
 * Two modes (dispatched by query param):
 *   ?lat=&lon=                            → current AQI (Gaussian + station blend)
 *   ?lat=&lng=&forecast_hours=24          → 24h forecast (from aqi_forecast table)
 *
 * Forecast mode merged in from former api/vayu/aqi-forecast.ts on 2026-05-26
 * (Hobby plan 12-fn quota consolidation, plan 09 Action C).
 */

// ─── Tile ID ────────────────────────────────────────────────
function latLonToTileId(lat: number, lon: number): string {
  return `tile:${Math.round(lat * 4000)}:${Math.round(lon * 4000)}`;
}

// ─── Freshness ──────────────────────────────────────────────
type Freshness = 'live' | 'recent' | 'stale' | 'fallback';
function getFreshness(computedAt: Date): Freshness {
  const ageMin = (Date.now() - computedAt.getTime()) / 60_000;
  if (ageMin < 15) return 'live';
  if (ageMin < 60) return 'recent';
  if (ageMin < 360) return 'stale';
  return 'fallback';
}

// ─── Redis helpers (Upstash REST) ───────────────────────────
async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.result ?? null;
  } catch { return null; }
}

async function redisSetEx(key: string, ttl: number, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal */ }
}

// ─── PM2.5 → US EPA AQI ────────────────────────────────────
function pm25ToAQI(pm25: number): number {
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

// ─── Gaussian dispersion helpers ────────────────────────────
function sigmaY(x: number): number { return 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5); }
function sigmaZ(x: number): number { return 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5); }

const FLEET_EMISSION = { nox: 1.2, pm25: 0.08, co: 7.5 };
const LANDUSE_MODIFIERS: Record<string, number> = {
  forest: 0.70, park: 0.80, meadow: 0.85, farmland: 0.90,
  residential: 1.00, commercial: 1.10, retail: 1.10, industrial: 1.25,
};

function gaussianConc(Q: number, wind: number, dist: number, H: number): number {
  const u = Math.max(wind, 0.5);
  const x = Math.max(dist, 10);
  const sy = sigmaY(x);
  const sz = sigmaZ(x);
  return Math.max(0, (Q * 1e6 / (Math.PI * sy * sz * u)) * 2 * Math.exp(-(H * H) / (2 * sz * sz)));
}

// ─── Region detection ───────────────────────────────────────
function detectRegion(lat: number, lon: number): string {
  // Bali
  if (lat >= -8.85 && lat <= -8.06 && lon >= 114.43 && lon <= 115.71) return 'bali';
  // Jawa
  if (lat >= -6.50 && lat <= -6.08 && lon >= 106.60 && lon <= 107.10) return 'jakarta';
  if (lat >= -7.02 && lat <= -6.82 && lon >= 107.45 && lon <= 107.77) return 'bandung';
  if (lat >= -7.40 && lat <= -7.15 && lon >= 112.55 && lon <= 112.85) return 'surabaya';
  if (lat >= -7.10 && lat <= -6.90 && lon >= 110.30 && lon <= 110.50) return 'semarang';
  if (lat >= -7.87 && lat <= -7.72 && lon >= 110.30 && lon <= 110.50) return 'yogyakarta';
  if (lat >= -7.62 && lat <= -7.50 && lon >= 110.75 && lon <= 110.90) return 'solo';
  if (lat >= -8.05 && lat <= -7.90 && lon >= 112.58 && lon <= 112.68) return 'malang';
  // Sulawesi
  if (lat >= -5.60 && lat <= -2.80 && lon >= 119.25 && lon <= 120.65) return 'sulsel';
  if (lat >= -3.60 && lat <= -1.40 && lon >= 118.70 && lon <= 119.45) return 'sulbar';
  if (lat >= -2.10 && lat <= 0.90 && lon >= 119.60 && lon <= 123.40) return 'sulteng';
  if (lat >= 0.20 && lat <= 0.95 && lon >= 121.80 && lon <= 123.15) return 'gorontalo';
  if (lat >= 0.30 && lat <= 1.65 && lon >= 123.20 && lon <= 125.30) return 'sulut';
  if (lat >= -5.55 && lat <= -3.00 && lon >= 121.30 && lon <= 124.10) return 'sultra';
  return 'unknown';
}

// ─── Diurnal traffic modifier ───────────────────────────────
const HOURLY_TRAFFIC: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
  5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
  10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
  15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
  20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
};

// ─── AQI Response type ──────────────────────────────────────
type AqiSourceKind = 'station' | 'satellite' | 'model' | 'crowdsource';

interface AqiSource {
  source: AqiSourceKind;
  value: number;           // PM2.5 contributed (μg/m³)
  distance_km?: number;
  age_hours?: number;
  count?: number;
  weight: number;          // blending weight assigned
}

interface AQIResponse {
  tile_id: string;
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  co: number;
  o3: number;
  confidence: number;
  source_breakdown: AqiSource[];
  layer_source: number;
  freshness: Freshness;
  computed_at: string;
  region: string;
}

// ─── Haversine distance (km) ────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── WAQI nearest station ──────────────────────────────────
interface StationData {
  pm25: number; no2: number; aqi: number; distance_km: number;
}
async function getNearestStation(lat: number, lon: number): Promise<StationData | null> {
  const token = process.env.WAQI_TOKEN || process.env.VITE_WAQI_TOKEN;
  if (!token) return null;
  try {
    const resp = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${token}`);
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.status !== 'ok' || !json.data) return null;
    const d = json.data;
    const sLat = d.city?.geo?.[0];
    const sLon = d.city?.geo?.[1];
    const iaqi = d.iaqi ?? {};
    const pm25 = typeof iaqi.pm25?.v === 'number' ? iaqi.pm25.v : undefined;
    if (typeof sLat !== 'number' || typeof sLon !== 'number' || pm25 === undefined) return null;
    return {
      pm25,
      no2: typeof iaqi.no2?.v === 'number' ? iaqi.no2.v : 0,
      aqi: typeof d.aqi === 'number' ? d.aqi : pm25ToAQI(pm25),
      distance_km: haversineKm(lat, lon, sLat, sLon),
    };
  } catch { return null; }
}

// ─── Nearby crowdsourced reports ────────────────────────────
interface CrowdReport { pm25: number; aqi: number; }
async function getNearbyReports(lat: number, lon: number, radiusKm: number, maxAgeHours: number): Promise<CrowdReport[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    // Use PostGIS RPC if exists; otherwise bbox filter via REST.
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
    const params = new URLSearchParams({
      select: 'pm25,aqi',
      created_at: `gte.${cutoff}`,
    });
    const resp = await fetch(
      `${url}/rest/v1/air_quality_reports?${params}&lat=gte.${lat - dLat}&lat=lte.${lat + dLat}&lon=gte.${lon - dLon}&lon=lte.${lon + dLon}&limit=20`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) return [];
    const rows = await resp.json();
    return rows.filter((r: any) => typeof r.pm25 === 'number');
  } catch { return []; }
}

// ─── Postgres confidence helper (uses migration 0016 function) ─
async function computeConfidence(args: {
  has_station: boolean; station_distance_km: number;
  has_satellite: boolean; satellite_age_hours: number;
  has_model: boolean; has_crowdsource: boolean; crowdsource_count: number;
}): Promise<number> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return args.has_model ? 0.2 : 0.0;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/compute_aqi_confidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(args),
    });
    if (!r.ok) return 0.2;
    const v = await r.json();
    return typeof v === 'number' ? v : 0.2;
  } catch { return 0.2; }
}

// ─── Open-Meteo baseline fetch (the fallback-safe core) ────
async function fetchOpenMeteoAQI(lat: number, lon: number) {
  const [aqResp, wxResp] = await Promise.all([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&timezone=auto`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&timezone=auto`),
  ]);

  const aq = aqResp.ok ? (await aqResp.json()).current : null;
  const wx = wxResp.ok ? (await wxResp.json()).current : null;

  return {
    pm25: aq?.pm2_5 ?? 15,
    pm10: aq?.pm10 ?? 25,
    no2: aq?.nitrogen_dioxide ?? 10,
    co: aq?.carbon_monoxide ?? 200,
    o3: aq?.ozone ?? 30,
    wind_speed: wx?.wind_speed_10m ?? 2.0,
  };
}

// ─── Supabase RPC: find nearby roads ────────────────────────
async function findNearbyRoads(lat: number, lon: number): Promise<Array<{
  distance_m: number; traffic_base_estimate: number;
  traffic_calibration_factor: number; landuse_proxy: string | null;
  canyon_ratio: number | null;
}>> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_nearby_roads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ lat, lon, radius_m: 500, max_results: 10 }),
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ─── Main compute (multi-source blended + dispersion delta) ─
async function compute(lat: number, lon: number): Promise<Omit<AQIResponse, 'tile_id' | 'freshness' | 'computed_at'>> {
  const region = detectRegion(lat, lon);

  // Fetch all sources in parallel
  const [baseline, station, reports, roads] = await Promise.all([
    fetchOpenMeteoAQI(lat, lon),
    getNearestStation(lat, lon),
    getNearbyReports(lat, lon, 0.5, 2),
    findNearbyRoads(lat, lon),
  ]);

  // Build weighted blend of pm25/no2 from independent sources.
  const sources: AqiSource[] = [];
  let pm25Sum = 0, no2Sum = 0, weightSum = 0;

  // Station (highest weight, decay with distance)
  if (station && station.distance_km < 30) {
    const w = Math.max(0.05, 0.5 * Math.exp(-station.distance_km / 8));
    pm25Sum += station.pm25 * w;
    no2Sum += station.no2 * w;
    weightSum += w;
    sources.push({ source: 'station', value: station.pm25, distance_km: station.distance_km, weight: w });
  }

  // Model (Open-Meteo) — always available
  {
    const w = 0.2;
    pm25Sum += baseline.pm25 * w;
    no2Sum += baseline.no2 * w;
    weightSum += w;
    sources.push({ source: 'model', value: baseline.pm25, weight: w });
  }

  // Crowdsource — last 2h within 500m
  if (reports.length > 0) {
    const avgPm25 = reports.reduce((s, r) => s + r.pm25, 0) / reports.length;
    const w = Math.min(0.4, 0.1 * reports.length);
    pm25Sum += avgPm25 * w;
    weightSum += w;
    sources.push({ source: 'crowdsource', value: avgPm25, count: reports.length, weight: w });
  }

  const blendedPm25 = weightSum > 0 ? pm25Sum / weightSum : baseline.pm25;
  const blendedNo2 = weightSum > 0 ? no2Sum / weightSum : baseline.no2;

  // Dispersion delta from nearby roads (added on top of blended baseline)
  const diurnal = HOURLY_TRAFFIC[new Date().getHours()] ?? 1.0;
  let pm25Delta = 0, no2Delta = 0, coFraction = 0;
  for (const road of roads) {
    const traffic = (road.traffic_base_estimate || 100) * (road.traffic_calibration_factor || 1.0) * diurnal;
    const dist = Math.max(road.distance_m, 10);
    const qPM25 = (traffic * FLEET_EMISSION.pm25) / 3600 / 1000;
    const qNOx = (traffic * FLEET_EMISSION.nox) / 3600 / 1000;
    const qCO = (traffic * FLEET_EMISSION.co) / 3600 / 1000;
    const veg = LANDUSE_MODIFIERS[road.landuse_proxy || ''] ?? 1.0;
    const canyon = 1.0 + (road.canyon_ratio || 0) * 0.3;
    pm25Delta += gaussianConc(qPM25, baseline.wind_speed, dist, 0.5) * veg * canyon;
    no2Delta += gaussianConc(qNOx, baseline.wind_speed, dist, 0.5) * veg * canyon;
    coFraction += gaussianConc(qCO, baseline.wind_speed, dist, 0.5) * veg * canyon;
  }

  const pm25 = Math.max(0, blendedPm25 + pm25Delta);
  const pm10 = Math.max(0, baseline.pm10 + pm25Delta * 1.5);
  const no2 = Math.max(0, blendedNo2 + no2Delta);
  const co = Math.max(0, baseline.co + coFraction);
  const o3 = baseline.o3;

  const confidence = await computeConfidence({
    has_station: !!station,
    station_distance_km: station?.distance_km ?? 99,
    has_satellite: false,                   // wired by Phase 1.2
    satellite_age_hours: 99,
    has_model: true,                        // Open-Meteo always present
    has_crowdsource: reports.length > 0,
    crowdsource_count: reports.length,
  });

  return {
    aqi: pm25ToAQI(pm25),
    pm25: Math.round(pm25 * 100) / 100,
    pm10: Math.round(pm10 * 100) / 100,
    no2: Math.round(no2 * 100) / 100,
    co: Math.round(co * 100) / 100,
    o3: Math.round(o3 * 100) / 100,
    confidence,
    source_breakdown: sources,
    layer_source: roads.length > 0 ? 1 : 0,
    region,
  };
}

// ─── Forecast mode (merged from former aqi-forecast.ts on 2026-05-26) ────
//
// Dispatched from handler when ?forecast_hours=N present (current-AQI path
// untouched). Reads from public.aqi_forecast table (populated hourly by
// vayu/ml/forecast_hourly.py on PC). Falls back to "no_forecast_available"
// when no rows for cell_id.
interface ForecastRow {
  forecast_hour: number;
  predicted_pm25: number;
  predicted_aqi: number;
  forecast_made_at: string;
}

const H3_RES_FORECAST = 7;

async function handleForecastMode(req: VercelRequest, res: VercelResponse) {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: 'Supabase env missing' });
  }

  let cellId = String(req.query.cell_id ?? '').trim();
  // Accept either `lng` (forecast convention from old aqi-forecast.ts) OR
  // `lon` (current-AQI convention) so caller doesn't need to pick.
  const lngQuery = req.query.lng ?? req.query.lon;
  if (!cellId && req.query.lat && lngQuery) {
    const lat = Number(req.query.lat);
    const lng = Number(lngQuery);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      try {
        cellId = latLngToCell(lat, lng, H3_RES_FORECAST);
      } catch {
        return res.status(400).json({ error: 'Invalid lat/lng' });
      }
    }
  }
  if (!cellId) {
    return res.status(400).json({ error: 'cell_id or (lat,lng) required' });
  }

  // forecast_hours = hours to project forward (1-24). Dispatch trigger AND value.
  const hours = Math.min(24, Math.max(1, Number(req.query.forecast_hours ?? 24)));

  const r = await fetch(
    `${supaUrl}/rest/v1/aqi_forecast?cell_id=eq.${encodeURIComponent(cellId)}` +
    `&select=forecast_hour,predicted_pm25,predicted_aqi,forecast_made_at` +
    `&order=forecast_made_at.desc,forecast_hour.asc&limit=${hours * 3}`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
  );
  if (!r.ok) {
    return res.status(500).json({ error: 'forecast query failed', status: r.status });
  }
  const allRows: ForecastRow[] = await r.json();
  if (allRows.length === 0) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.json({ cell_id: cellId, predictions: [], fallback: 'no_forecast_available' });
  }

  const latestBatch = allRows[0].forecast_made_at;
  const predictions = allRows
    .filter(r => r.forecast_made_at === latestBatch)
    .sort((a, b) => a.forecast_hour - b.forecast_hour)
    .slice(0, hours)
    .map(r => ({
      hour: r.forecast_hour,
      pm25: Math.round(r.predicted_pm25 * 100) / 100,
      aqi: r.predicted_aqi,
    }));

  const best = predictions.reduce<{ hour: number; aqi: number } | null>((acc, p) =>
    acc == null || p.aqi < acc.aqi ? { hour: p.hour, aqi: p.aqi } : acc, null);

  res.setHeader('Cache-Control', 'public, max-age=1800');
  return res.json({
    cell_id: cellId,
    forecast_made_at: latestBatch,
    predictions,
    best_hour: best,
  });
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Dispatch: forecast mode short-circuits BEFORE current-AQI cron/coord checks.
  // Frontend sends ?forecast_hours=24 (RouteForecast.tsx); presence = forecast mode.
  if (req.query.forecast_hours !== undefined) {
    return handleForecastMode(req, res);
  }

  // Cron auth guard (Migration 0012 — pg_cron → Vercel webhook).
  // If header is present, it MUST match BREEVA_CRON_SECRET. Absent header
  // means a normal user request — continue without auth.
  // .trim() defends against env vars that ship with stray whitespace/newlines.
  const cronSecret = (req.headers['x-breeva-cron-secret'] as string | undefined)?.trim();
  const expectedSecret = process.env.BREEVA_CRON_SECRET?.trim();
  if (cronSecret && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon query parameters required' });
  }

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lon as string);
  if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const tileId = latLonToTileId(latitude, longitude);
    const redisKey = `vayu:tile:${tileId}`;

    // Layer 1: Redis cache
    const cached = await redisGet(redisKey);
    if (cached) {
      try {
        const data = JSON.parse(cached) as AQIResponse;
        data.freshness = getFreshness(new Date(data.computed_at));
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.setHeader('X-Cache', 'HIT-REDIS');
        return res.status(200).json({ data });
      } catch { /* corrupted cache, continue */ }
    }

    // Layer 2: Compute
    const result = await compute(latitude, longitude);
    const now = new Date().toISOString();
    const data: AQIResponse = { tile_id: tileId, ...result, freshness: 'live', computed_at: now };

    // Cache in Redis (15 min)
    await redisSetEx(redisKey, 900, JSON.stringify(data));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ data });
  } catch (error) {
    console.error('VAYU AQI error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
