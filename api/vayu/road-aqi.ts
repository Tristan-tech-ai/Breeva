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

// ─── Highway class → estimated vehicles/hour (when DB has no calibrated data) ──
const HIGHWAY_TRAFFIC: Record<string, number> = {
  motorway: 4000, motorway_link: 2000,
  trunk: 2500, trunk_link: 1200,
  primary: 1500, primary_link: 800,
  secondary: 800, secondary_link: 400,
  tertiary: 400, tertiary_link: 200,
  residential: 80, living_street: 20,
  service: 15, unclassified: 50,
  pedestrian: 2, footway: 0, cycleway: 0, path: 0,
};

// ─── Deterministic per-road jitter from osm_way_id ──────────
// Produces ±20% variation so same-class roads don't appear identical
function roadJitter(osmWayId: number): number {
  const hash = ((osmWayId * 2654435761) >>> 0) / 4294967296;
  return 0.80 + hash * 0.40; // range [0.8, 1.2]
}

// ─── Estimate traffic from highway class + lanes when no calibrated data ──
function estimateTraffic(road: RoadRow, diurnal: number): number {
  // Use calibrated data if available
  if (road.traffic_base_estimate && road.traffic_base_estimate > 0) {
    return road.traffic_base_estimate * (road.traffic_calibration_factor || 1.0) * diurnal;
  }
  // Derive from highway classification
  const base = HIGHWAY_TRAFFIC[road.highway] ?? 50;
  // Lane multiplier: 4-lane primary = 2× traffic of 2-lane primary
  const defaultLanes = ['motorway', 'trunk'].includes(road.highway) ? 4
                     : ['primary', 'secondary'].includes(road.highway) ? 2 : 1;
  const lanes = road.lanes || defaultLanes;
  const laneFactor = Math.max(1, lanes / defaultLanes);
  return base * laneFactor * diurnal;
}

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
    case 'motorway': case 'trunk': return 5;
    case 'primary': return 4;
    case 'secondary': return 3.5;
    case 'tertiary': return 3;
    case 'residential': return 2.5;
    default: return 2;
  }
}

// ─── Zoom-based road limit + filtering ──────────────────────
function getQueryParams(zoom: number): { limit: number; highways: string[] | null } {
  if (zoom >= 16) return { limit: 800, highways: null };          // all roads, high cap
  if (zoom >= 15) return { limit: 500, highways: null };          // all roads
  if (zoom >= 14) return { limit: 400, highways: null };          // all roads
  if (zoom >= 13) return { limit: 300, highways: null };          // all roads
  if (zoom >= 12) return { limit: 200, highways: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'] };
  if (zoom >= 11) return { limit: 150, highways: ['motorway', 'motorway_link', 'trunk', 'trunk_link'] };
  return { limit: 80, highways: ['motorway', 'trunk'] };
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
  o3: number;
  pm10: number;
  highway: string;
  weight: number;
}

// ─── Open-Meteo single-point fetch ──────────────────────────
// forecastHour: 0 = current (default), 1-24 = hours ahead
async function fetchBaselinePoint(lat: number, lon: number, forecastHour = 0) {
  if (forecastHour <= 0) {
    // Current conditions (original behavior)
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

  // Forecast mode: fetch hourly data and pick the target hour
  const [aqResp, wxResp] = await Promise.all([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&forecast_hours=${forecastHour + 1}&timezone=auto`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m&forecast_hours=${forecastHour + 1}&timezone=auto`),
  ]);
  const aq = aqResp.ok ? await aqResp.json() : null;
  const wx = wxResp.ok ? await wxResp.json() : null;
  const idx = forecastHour; // array index = hours from now
  return {
    pm25: aq?.hourly?.pm2_5?.[idx] ?? 15,
    pm10: aq?.hourly?.pm10?.[idx] ?? 25,
    no2: aq?.hourly?.nitrogen_dioxide?.[idx] ?? 10,
    co: aq?.hourly?.carbon_monoxide?.[idx] ?? 200,
    o3: aq?.hourly?.ozone?.[idx] ?? 30,
    wind_speed: wx?.hourly?.wind_speed_10m?.[idx] ?? 2.0,
  };
}

type BaselineData = Awaited<ReturnType<typeof fetchBaselinePoint>>;

// ─── Multi-point baseline grid for spatial interpolation ────
// Samples 5 points (4 corners + center) to get spatial variation
// Returns an interpolation function that gives baseline at any lat/lng
async function fetchBaselineGrid(south: number, west: number, north: number, east: number, forecastHour = 0) {
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;

  // Fetch 5 points in parallel: center + 4 corners
  const [center, nw, ne, sw, se] = await Promise.all([
    fetchBaselinePoint(cLat, cLon, forecastHour),
    fetchBaselinePoint(north, west, forecastHour),
    fetchBaselinePoint(north, east, forecastHour),
    fetchBaselinePoint(south, west, forecastHour),
    fetchBaselinePoint(south, east, forecastHour),
  ]);

  // Bilinear interpolation function
  const interpolate = (lat: number, lon: number): BaselineData => {
    // Normalize position within bbox [0,1]
    const latSpan = north - south || 0.001;
    const lonSpan = east - west || 0.001;
    const ty = Math.max(0, Math.min(1, (lat - south) / latSpan)); // 0=south, 1=north
    const tx = Math.max(0, Math.min(1, (lon - west) / lonSpan));  // 0=west, 1=east

    // Weight center point (40%) + bilinear corners (60%) for stability
    const keys = ['pm25', 'pm10', 'no2', 'co', 'o3', 'wind_speed'] as const;
    const result = {} as Record<string, number>;
    for (const k of keys) {
      const topVal = nw[k] * (1 - tx) + ne[k] * tx;
      const botVal = sw[k] * (1 - tx) + se[k] * tx;
      const bilinear = botVal * (1 - ty) + topVal * ty;
      result[k] = bilinear * 0.6 + center[k] * 0.4;
    }
    return result as unknown as BaselineData;
  };

  return { center, interpolate };
}

// ─── WAQI station bias correction ───────────────────────────
// Fetches nearest WAQI station reading for the viewport center,
// compares against Open-Meteo baseline, returns additive bias.
// Cached in Redis for 1 hour to conserve WAQI quota (1000 req/day).
interface WAQIBias {
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  stationName: string | null;
}

async function fetchWAQIBias(lat: number, lon: number, openMeteoBaseline: BaselineData): Promise<WAQIBias> {
  const noBias: WAQIBias = { pm25: 0, pm10: 0, no2: 0, o3: 0, stationName: null };

  const token = process.env.WAQI_TOKEN;
  if (!token) return noBias;

  // Check Redis cache first (1h TTL, quantized to ~0.05° ≈ 5km grid)
  const q = (v: number) => (Math.round(v * 20) / 20).toFixed(2);
  const cacheKey = `vayu:waqi:${q(lat)}:${q(lon)}`;

  const cached = await redisGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  try {
    const resp = await fetch(
      `https://api.waqi.info/feed/geo:${lat.toFixed(4)};${lon.toFixed(4)}/?token=${encodeURIComponent(token)}`
    );
    if (!resp.ok) return noBias;
    const json = await resp.json();
    if (json.status !== 'ok' || !json.data?.iaqi) return noBias;

    const iaqi = json.data.iaqi;
    const stationName: string = json.data.city?.name ?? null;

    // Extract pollutant concentrations from WAQI (values are in AQI sub-index)
    // Convert PM2.5 AQI → µg/m³ using EPA breakpoints
    const waqiPm25 = iaqi.pm25?.v != null ? pm25AQIToUg(iaqi.pm25.v) : null;
    // NO₂ AQI → ppb → µg/m³ (1 ppb ≈ 1.88 µg/m³ at STP)
    const waqiNo2 = iaqi.no2?.v != null ? no2AQIToUg(iaqi.no2.v) : null;
    // O₃ AQI → ppb → µg/m³ (1 ppb ≈ 2.0 µg/m³ at STP)
    const waqiO3 = iaqi.o3?.v != null ? o3AQIToUg(iaqi.o3.v) : null;
    // PM10 AQI → µg/m³
    const waqiPm10 = iaqi.pm10?.v != null ? pm10AQIToUg(iaqi.pm10.v) : null;

    // Compute bias: observed (WAQI) - modeled (Open-Meteo)
    // Clamp to ±50% of baseline to prevent wild swings from distant stations
    const clampBias = (observed: number | null, modeled: number): number => {
      if (observed == null) return 0;
      const raw = observed - modeled;
      const maxBias = Math.abs(modeled) * 0.5;
      return Math.max(-maxBias, Math.min(maxBias, raw));
    };

    const bias: WAQIBias = {
      pm25: clampBias(waqiPm25, openMeteoBaseline.pm25),
      pm10: clampBias(waqiPm10, openMeteoBaseline.pm10),
      no2: clampBias(waqiNo2, openMeteoBaseline.no2),
      o3: clampBias(waqiO3, openMeteoBaseline.o3),
      stationName,
    };

    // Cache for 1 hour
    await redisSetEx(cacheKey, 3600, JSON.stringify(bias));
    return bias;
  } catch {
    return noBias;
  }
}

// ─── WAQI AQI → concentration converters (US EPA breakpoints) ─
function pm25AQIToUg(aqi: number): number {
  const bp = [ [0,50,0,12], [51,100,12.1,35.4], [101,150,35.5,55.4], [151,200,55.5,150.4], [201,300,150.5,250.4], [301,500,250.5,500.4] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return ((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo;
  }
  return 500;
}

function pm10AQIToUg(aqi: number): number {
  const bp = [ [0,50,0,54], [51,100,55,154], [101,150,155,254], [151,200,255,354], [201,300,355,424], [301,500,425,604] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return ((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo;
  }
  return 604;
}

function no2AQIToUg(aqi: number): number {
  // EPA NO₂ breakpoints in ppb, convert to µg/m³ (* 1.88)
  const bp = [ [0,50,0,53], [51,100,54,100], [101,150,101,360], [151,200,361,649], [201,300,650,1249], [301,500,1250,2049] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return (((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo) * 1.88;
  }
  return 2049 * 1.88;
}

function o3AQIToUg(aqi: number): number {
  // EPA O₃ breakpoints in ppb, convert to µg/m³ (* 2.0)
  const bp = [ [0,50,0,54], [51,100,55,70], [101,150,71,85], [151,200,86,105], [201,300,106,200] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return (((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo) * 2.0;
  }
  return 200 * 2.0;
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
  baseline: { pm25: number; pm10: number; no2: number; o3: number; wind_speed: number },
  diurnal: number
): { aqi: number; pm25: number; no2: number; o3: number; pm10: number } {
  const traffic = estimateTraffic(road, diurnal);
  const jitter = roadJitter(road.osm_way_id);

  // Self-road contribution at ~10m distance (on-road exposure)
  const dist = 10;
  const qPM25 = (traffic * FLEET_EMISSION.pm25) / 3600 / 1000;
  const qNOx  = (traffic * FLEET_EMISSION.nox) / 3600 / 1000;

  const veg = LANDUSE_MODIFIERS[road.landuse_proxy || ''] ?? 1.0;

  // Enhanced canyon effect — OSPM-inspired non-linear model
  // Aspect ratio H/W: deep canyons trap pollution in recirculation vortex
  const aspectRatio = road.canyon_ratio || 0;
  // Non-linear: shallow canyons (AR<0.5) have weak effect, deep canyons (AR>1.5) plateau
  // Wind reduction: canyons shelter from wind, reducing dispersion
  const canyonTrap = aspectRatio > 0
    ? 1.0 + 0.8 * (1 - Math.exp(-1.5 * aspectRatio))  // asymptotic: max ~1.8× at very deep canyons
    : 1.0;
  // Wind sheltering: deep canyons reduce effective wind speed
  const windShelter = aspectRatio > 0
    ? Math.max(0.3, 1.0 - 0.4 * Math.min(aspectRatio, 2.0))  // min 30% of ambient wind
    : 1.0;
  const effectiveWind = baseline.wind_speed * windShelter;

  // Narrower roads trap pollution more (8m reference width)
  const widthFactor = road.width ? Math.max(0.8, Math.min(1.5, 8.0 / road.width)) : 1.0;

  const pm25Delta = gaussianConc(qPM25, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * jitter;
  const no2Delta  = gaussianConc(qNOx, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * jitter;

  // PM₁₀ = PM₂.₅ delta + coarse fraction (tire wear, brake dust, road dust)
  const pm10Delta = pm25Delta * 1.8;

  // O₃ titration: NOx from traffic destroys ozone near roads
  // Higher traffic → more NOx → more O₃ consumed → lower roadside O₃
  const o3Titration = no2Delta * 0.4;

  const pm25 = Math.max(0, baseline.pm25 + pm25Delta);
  const no2  = Math.max(0, baseline.no2 + no2Delta);
  const pm10 = Math.max(0, baseline.pm10 + pm10Delta);
  const o3   = Math.max(0, baseline.o3 - o3Titration);
  const aqi  = pm25ToAQI(pm25);

  return {
    aqi,
    pm25: Math.round(pm25 * 100) / 100,
    no2: Math.round(no2 * 100) / 100,
    o3: Math.round(o3 * 100) / 100,
    pm10: Math.round(pm10 * 100) / 100,
  };
}

// ─── Cache key from bbox (quantized to ~500m grid) ──────────
function bboxCacheKey(south: number, west: number, north: number, east: number, zoom: number, forecastHour = 0): string {
  // Quantize to ~0.005° grid (~550m) for cache deduplication
  const q = (v: number) => (Math.round(v * 200) / 200).toFixed(3);
  const base = `vayu:road:${q(south)}:${q(west)}:${q(north)}:${q(east)}:z${zoom}`;
  return forecastHour > 0 ? `${base}:fh${forecastHour}` : base;
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { south, west, north, east, zoom, forecast_hour } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(400).json({ error: 'south, west, north, east query parameters required' });
  }

  const s = parseFloat(south as string);
  const w = parseFloat(west as string);
  const n = parseFloat(north as string);
  const e = parseFloat(east as string);
  const z = parseInt(zoom as string) || 15;
  const fh = Math.max(0, Math.min(24, parseInt(forecast_hour as string) || 0));

  // Validate coordinates
  if ([s, w, n, e].some(isNaN) || s > n || w > e) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }

  // Limit bbox size based on zoom level to prevent abuse
  // z11 viewport ≈ 0.5°, z12 ≈ 0.3°, z13+ ≈ 0.15°
  const maxSpan = z <= 11 ? 0.5 : z <= 12 ? 0.3 : 0.15;
  if (n - s > maxSpan || e - w > maxSpan) {
    return res.status(400).json({ error: 'Bounding box too large. Zoom in more.' });
  }

  try {
    const cacheKey = bboxCacheKey(s, w, n, e, z, fh);

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

    // Fetch baseline AQI grid (5-point spatial interpolation)
    const { center: baselineCenter, interpolate: interpBaseline } = await fetchBaselineGrid(s, w, n, e, fh);

    // WAQI station bias correction (only for current conditions, not forecast)
    const cLat = (s + n) / 2;
    const cLon = (w + e) / 2;
    const bias = fh === 0
      ? await fetchWAQIBias(cLat, cLon, baselineCenter)
      : { pm25: 0, pm10: 0, no2: 0, o3: 0, stationName: null } as WAQIBias;

    // Wrap interpolation with bias correction
    const interpCorrected = (lat: number, lon: number): BaselineData => {
      const raw = interpBaseline(lat, lon);
      return {
        ...raw,
        pm25: Math.max(0, raw.pm25 + bias.pm25),
        pm10: Math.max(0, raw.pm10 + bias.pm10),
        no2: Math.max(0, raw.no2 + bias.no2),
        o3: Math.max(0, raw.o3 + bias.o3),
      } as BaselineData;
    };

    // Use forecast hour for diurnal profile: shift current hour by forecast offset
    const targetHour = (new Date().getHours() + fh) % 24;
    const diurnal = HOURLY_TRAFFIC[targetHour] ?? 1.0;

    // Compute per-road AQI with spatially interpolated baseline
    const features: RoadAQIFeature[] = [];
    for (const road of filtered) {
      let geometry: { type: string; coordinates: number[][] };
      try {
        geometry = JSON.parse(road.geojson);
      } catch { continue; }

      // Get road centroid for baseline interpolation
      const coords = geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      const roadLon = mid[0];
      const roadLat = mid[1];
      const baseline = interpCorrected(roadLat, roadLon);

      const { aqi, pm25, no2, o3, pm10 } = computeRoadAQI(road, baseline, diurnal);

      features.push({
        osm_way_id: road.osm_way_id,
        geometry,
        aqi,
        pm25,
        no2,
        o3,
        pm10,
        highway: road.highway,
        weight: roadWeight(road.highway),
      });
    }

    const result = {
      roads: features,
      meta: {
        count: features.length,
        zoom: z,
        forecast_hour: fh,
        baseline_pm25: baselineCenter.pm25,
        baseline_no2: baselineCenter.no2,
        baseline_o3: baselineCenter.o3,
        baseline_pm10: baselineCenter.pm10,
        wind_speed: baselineCenter.wind_speed,
        waqi_station: bias.stationName,
        waqi_bias_pm25: Math.round(bias.pm25 * 100) / 100,
        waqi_bias_no2: Math.round(bias.no2 * 100) / 100,
        computed_at: new Date().toISOString(),
      },
    };

    // Cache: 15 min for current, 30 min for forecast (changes less frequently)
    await redisSetEx(cacheKey, fh > 0 ? 1800 : 900, JSON.stringify(result));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);

  } catch (error) {
    console.error('VAYU road-aqi error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
