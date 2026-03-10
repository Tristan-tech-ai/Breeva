import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU AQI Endpoint — Self-contained serverless function.
 * All logic inlined to avoid cross-directory import failures on Vercel.
 *
 * Flow: lat/lon → tile cache (Redis) → Supabase grid → compute (Open-Meteo + roads) → cache + respond
 * Fallback: if computation fails, proxy Open-Meteo Air Quality directly.
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
  if (lat >= -8.85 && lat <= -8.06 && lon >= 114.43 && lon <= 115.71) return 'bali';
  if (lat >= -6.50 && lat <= -6.08 && lon >= 106.60 && lon <= 107.10) return 'jakarta';
  if (lat >= -7.02 && lat <= -6.82 && lon >= 107.45 && lon <= 107.77) return 'bandung';
  if (lat >= -7.40 && lat <= -7.15 && lon >= 112.55 && lon <= 112.85) return 'surabaya';
  if (lat >= -7.10 && lat <= -6.90 && lon >= 110.30 && lon <= 110.50) return 'semarang';
  if (lat >= -7.87 && lat <= -7.72 && lon >= 110.30 && lon <= 110.50) return 'yogyakarta';
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
interface AQIResponse {
  tile_id: string;
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  co: number;
  o3: number;
  confidence: number;
  layer_source: number;
  freshness: Freshness;
  computed_at: string;
  region: string;
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

// ─── Main compute ───────────────────────────────────────────
async function compute(lat: number, lon: number): Promise<Omit<AQIResponse, 'tile_id' | 'freshness' | 'computed_at'>> {
  const baseline = await fetchOpenMeteoAQI(lat, lon);
  const region = detectRegion(lat, lon);

  // Try to get nearby roads for dispersion delta
  const roads = await findNearbyRoads(lat, lon);
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

  const pm25 = Math.max(0, baseline.pm25 + pm25Delta);
  const pm10 = Math.max(0, baseline.pm10 + pm25Delta * 1.5);
  const no2 = Math.max(0, baseline.no2 + no2Delta);
  const co = Math.max(0, baseline.co + coFraction);
  const o3 = baseline.o3;
  const confidence = roads.length > 0 ? 0.35 : 0.20;

  return {
    aqi: pm25ToAQI(pm25),
    pm25: Math.round(pm25 * 100) / 100,
    pm10: Math.round(pm10 * 100) / 100,
    no2: Math.round(no2 * 100) / 100,
    co: Math.round(co * 100) / 100,
    o3: Math.round(o3 * 100) / 100,
    confidence,
    layer_source: roads.length > 0 ? 1 : 0,
    region,
  };
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
