import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Road-AQI Endpoint — Returns per-road-segment pollution data for a bbox.
 * Used by RoadPollutionLayer to render eLichens-style colored road polylines.
 *
 * GET /api/vayu/road-aqi?south=&west=&north=&east=&zoom=
 *
 * Flow: bbox → find_roads_in_bbox RPC → compute per-road AQI → Redis cache → respond
 */

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

// ─── Gaussian dispersion (same as aqi.ts, inlined for Vercel) ───
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

// ─── Diurnal traffic modifier ───────────────────────────────
const HOURLY_TRAFFIC: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
  5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
  10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
  15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
  20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
};

// ─── Road class → weight for line rendering hint ────────────
function roadWeight(highway: string): number {
  switch (highway) {
    case 'motorway': case 'trunk': return 6;
    case 'primary': return 5;
    case 'secondary': return 4;
    case 'tertiary': return 3;
    default: return 2;
  }
}

// ─── Zoom-based road limit + filtering ──────────────────────
function getQueryParams(zoom: number): { limit: number; highways: string[] | null } {
  if (zoom >= 16) return { limit: 300, highways: null };          // all roads
  if (zoom >= 15) return { limit: 250, highways: null };          // all roads
  if (zoom >= 14) return { limit: 200, highways: null };          // all roads
  if (zoom >= 13) return { limit: 150, highways: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] };
  return { limit: 80, highways: ['motorway', 'trunk', 'primary'] };
}

// ─── Types ──────────────────────────────────────────────────
interface RoadRow {
  osm_way_id: number;
  geojson: string;
  highway: string;
  lanes: number | null;
  width: number | null;
  canyon_ratio: number | null;
  landuse_proxy: string | null;
  traffic_base_estimate: number;
  traffic_calibration_factor: number;
}

interface RoadAQIFeature {
  osm_way_id: number;
  geometry: { type: string; coordinates: number[][] };
  aqi: number;
  pm25: number;
  no2: number;
  highway: string;
  weight: number;
}

// ─── Open-Meteo baseline fetch ──────────────────────────────
async function fetchBaseline(lat: number, lon: number) {
  const [aqResp, wxResp] = await Promise.all([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&timezone=auto`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m&timezone=auto`),
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

// ─── Supabase RPC: find_roads_in_bbox ───────────────────────
async function findRoadsInBbox(
  south: number, west: number, north: number, east: number, limit: number
): Promise<RoadRow[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_roads_in_bbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ south, west, north, east, road_limit: limit }),
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ─── Compute per-road AQI ───────────────────────────────────
function computeRoadAQI(
  road: RoadRow,
  baseline: { pm25: number; no2: number; wind_speed: number },
  diurnal: number
): { aqi: number; pm25: number; no2: number } {
  const traffic = (road.traffic_base_estimate || 100) * (road.traffic_calibration_factor || 1.0) * diurnal;
  // Self-road contribution at ~10m distance (on-road exposure)
  const dist = 10;
  const qPM25 = (traffic * FLEET_EMISSION.pm25) / 3600 / 1000;
  const qNOx  = (traffic * FLEET_EMISSION.nox) / 3600 / 1000;
  const veg = LANDUSE_MODIFIERS[road.landuse_proxy || ''] ?? 1.0;
  const canyon = 1.0 + (road.canyon_ratio || 0) * 0.3;

  const pm25Delta = gaussianConc(qPM25, baseline.wind_speed, dist, 0.5) * veg * canyon;
  const no2Delta  = gaussianConc(qNOx, baseline.wind_speed, dist, 0.5) * veg * canyon;

  const pm25 = Math.max(0, baseline.pm25 + pm25Delta);
  const no2  = Math.max(0, baseline.no2 + no2Delta);
  const aqi  = pm25ToAQI(pm25);

  return {
    aqi,
    pm25: Math.round(pm25 * 100) / 100,
    no2: Math.round(no2 * 100) / 100,
  };
}

// ─── Cache key from bbox (quantized to ~500m grid) ──────────
function bboxCacheKey(south: number, west: number, north: number, east: number, zoom: number): string {
  // Quantize to ~0.005° grid (~550m) for cache deduplication
  const q = (v: number) => (Math.round(v * 200) / 200).toFixed(3);
  return `vayu:road:${q(south)}:${q(west)}:${q(north)}:${q(east)}:z${zoom}`;
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { south, west, north, east, zoom } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(400).json({ error: 'south, west, north, east query parameters required' });
  }

  const s = parseFloat(south as string);
  const w = parseFloat(west as string);
  const n = parseFloat(north as string);
  const e = parseFloat(east as string);
  const z = parseInt(zoom as string) || 15;

  // Validate coordinates
  if ([s, w, n, e].some(isNaN) || s > n || w > e) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }

  // Limit bbox size (~0.1° max span = ~11km) to prevent abuse
  if (n - s > 0.15 || e - w > 0.15) {
    return res.status(400).json({ error: 'Bounding box too large. Zoom in more.' });
  }

  try {
    const cacheKey = bboxCacheKey(s, w, n, e, z);

    // Check Redis cache first
    const cached = await redisGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cached));
    }

    // Query road segments in viewport
    const { limit, highways } = getQueryParams(z);
    const roads = await findRoadsInBbox(s, w, n, e, limit);

    if (roads.length === 0) {
      const empty = { roads: [], meta: { count: 0, zoom: z } };
      res.setHeader('Cache-Control', 's-maxage=120');
      return res.status(200).json(empty);
    }

    // Filter by highway class if zoom is low
    const filtered = highways
      ? roads.filter((r) => highways.includes(r.highway))
      : roads;

    // Fetch baseline AQI at bbox center (one call for entire viewport)
    const centerLat = (s + n) / 2;
    const centerLon = (w + e) / 2;
    const baseline = await fetchBaseline(centerLat, centerLon);
    const diurnal = HOURLY_TRAFFIC[new Date().getHours()] ?? 1.0;

    // Compute per-road AQI
    const features: RoadAQIFeature[] = [];
    for (const road of filtered) {
      let geometry: { type: string; coordinates: number[][] };
      try {
        geometry = JSON.parse(road.geojson);
      } catch { continue; }

      const { aqi, pm25, no2 } = computeRoadAQI(road, baseline, diurnal);

      features.push({
        osm_way_id: road.osm_way_id,
        geometry,
        aqi,
        pm25,
        no2,
        highway: road.highway,
        weight: roadWeight(road.highway),
      });
    }

    const result = {
      roads: features,
      meta: {
        count: features.length,
        zoom: z,
        baseline_pm25: baseline.pm25,
        baseline_no2: baseline.no2,
        wind_speed: baseline.wind_speed,
        computed_at: new Date().toISOString(),
      },
    };

    // Cache for 15 minutes
    await redisSetEx(cacheKey, 900, JSON.stringify(result));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);

  } catch (error) {
    console.error('VAYU road-aqi error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
