import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Route Score V2 — Full Gaussian dispersion per-road scoring.
 * Matches route polyline to road_segments via find_roads_along_route() RPC,
 * then runs the same physics model as road-aqi.ts for each matched segment.
 * Falls back to Open-Meteo baseline per-point when no road data is available.
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

// ─── Gaussian dispersion (copied from road-aqi.ts) ─────────
function sigmaY(x: number): number { return 0.08 * x * Math.pow(1 + 0.0001 * x, -0.5); }
function sigmaZ(x: number): number { return 0.06 * x * Math.pow(1 + 0.0015 * x, -0.5); }

const FLEET_EMISSION = { nox: 1.2, pm25: 0.08, co: 7.5 };
const LANDUSE_MODIFIERS: Record<string, number> = {
  forest: 0.70, park: 0.80, meadow: 0.85, farmland: 0.90,
  residential: 1.00, commercial: 1.10, retail: 1.10, industrial: 1.25,
};

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

const HOURLY_TRAFFIC: Record<number, number> = {
  0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
  5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
  10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
  15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
  20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
};

const SURFACE_PM10_FACTOR: Record<string, number> = {
  asphalt: 1.0, paved: 1.0, concrete: 0.9,
  compacted: 1.8, gravel: 3.0, fine_gravel: 2.5,
  dirt: 4.0, ground: 3.5, sand: 4.5, earth: 4.0,
  unpaved: 3.5, mud: 1.5,
};

function roadJitter(osmWayId: number): number {
  const hash = ((osmWayId * 2654435761) >>> 0) / 4294967296;
  return 0.80 + hash * 0.40;
}

function elevationFactor(elevationM: number | null): number {
  if (elevationM == null || elevationM <= 0) return 1.0;
  return Math.max(0.80, Math.exp(-elevationM / 8500));
}

function gaussianConc(Q: number, wind: number, dist: number, H: number): number {
  const u = Math.max(wind, 0.5);
  const x = Math.max(dist, 10);
  const sy = sigmaY(x);
  const sz = sigmaZ(x);
  return Math.max(0, (Q * 1e6 / (Math.PI * sy * sz * u)) * 2 * Math.exp(-(H * H) / (2 * sz * sz)));
}

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

// ─── Vehicle routing weights ────────────────────────────────
const VEHICLE_WEIGHTS: Record<string, { aqi: number; time: number }> = {
  pedestrian:  { aqi: 0.70, time: 0.30 },
  bicycle:     { aqi: 0.60, time: 0.40 },
  motorcycle:  { aqi: 0.50, time: 0.50 },
  car:         { aqi: 0.40, time: 0.60 },
  public:      { aqi: 0.30, time: 0.70 },
};

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
  name: string | null;
  surface: string | null;
  elevation_avg: number | null;
  micro_class: string | null;
  ai_pollution_factor: number | null;
  fraction_along: number;
}

interface BaselineData {
  pm25: number; pm10: number; no2: number;
  co: number; o3: number; wind_speed: number;
}

// ─── Traffic estimation (from road-aqi.ts) ──────────────────
function estimateTraffic(road: RoadRow, diurnal: number): number {
  if (road.traffic_base_estimate && road.traffic_base_estimate > 0) {
    return road.traffic_base_estimate * (road.traffic_calibration_factor || 1.0) * diurnal;
  }
  if (road.micro_class) {
    const aiTraffic: Record<string, number> = {
      highway: 4000, arterial: 1500, collector: 600, local_road: 150,
      neighborhood_road: 50, alley: 10, gang: 2, pedestrian_only: 0,
    };
    const base = aiTraffic[road.micro_class];
    if (base != null) return base * diurnal;
  }
  if (road.highway === 'residential' || road.highway === 'living_street') {
    const w = road.width;
    if (w != null && w < 3)  return 2 * diurnal;
    if (w != null && w < 5)  return 15 * diurnal;
    if (w != null && w < 6)  return 40 * diurnal;
    if (road.name) {
      const lower = road.name.toLowerCase();
      if (lower.includes('gang') || lower.includes('gg.') || lower.includes('lorong') ||
          lower.includes('jalan setapak') || lower.includes('lr.') || lower.includes('jl. setapak')) {
        return 5 * diurnal;
      }
    }
  }
  if (road.highway === 'service') {
    if (road.landuse_proxy === 'residential') return 5 * diurnal;
    if (road.landuse_proxy === 'industrial') return 30 * diurnal;
  }
  const base = HIGHWAY_TRAFFIC[road.highway] ?? 50;
  const defaultLanes = ['motorway', 'trunk'].includes(road.highway) ? 4
                     : ['primary', 'secondary'].includes(road.highway) ? 2 : 1;
  const lanes = road.lanes || defaultLanes;
  const laneFactor = Math.max(1, lanes / defaultLanes);
  return base * laneFactor * diurnal;
}

// ─── Compute per-road AQI (from road-aqi.ts) ───────────────
function computeRoadAQI(
  road: RoadRow,
  baseline: { pm25: number; pm10: number; no2: number; o3: number; wind_speed: number },
  diurnal: number
): { aqi: number; pm25: number; no2: number; o3: number; pm10: number } {
  const traffic = estimateTraffic(road, diurnal);
  const jitter = roadJitter(road.osm_way_id);
  const dist = 10;
  const qPM25 = (traffic * FLEET_EMISSION.pm25) / 3600 / 1000;
  const qNOx  = (traffic * FLEET_EMISSION.nox) / 3600 / 1000;
  const veg = LANDUSE_MODIFIERS[road.landuse_proxy || ''] ?? 1.0;
  const aspectRatio = road.canyon_ratio || 0;
  const canyonTrap = aspectRatio > 0
    ? 1.0 + 0.8 * (1 - Math.exp(-1.5 * aspectRatio))
    : 1.0;
  const windShelter = aspectRatio > 0
    ? Math.max(0.3, 1.0 - 0.4 * Math.min(aspectRatio, 2.0))
    : 1.0;
  const effectiveWind = baseline.wind_speed * windShelter;
  const rawWidthFactor = road.width ? Math.max(0.8, Math.min(1.5, 8.0 / road.width)) : 1.0;
  const widthFactor = traffic > 50 ? rawWidthFactor : 1.0 + (rawWidthFactor - 1.0) * Math.min(1, traffic / 50);
  const elevFactor = elevationFactor(road.elevation_avg);

  let pm25Delta = gaussianConc(qPM25, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * jitter;
  let no2Delta  = gaussianConc(qNOx, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * jitter;

  if (road.ai_pollution_factor != null) {
    pm25Delta *= road.ai_pollution_factor;
    no2Delta  *= road.ai_pollution_factor;
  }

  const surfacePM10 = SURFACE_PM10_FACTOR[road.surface || ''] ?? 1.0;
  const pm10Delta = pm25Delta * 1.8 * surfacePM10;
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

// ─── Baseline grid fetch (from road-aqi.ts) ─────────────────
async function fetchBaselineBatch(
  lats: number[], lons: number[], forecastHour = 0,
): Promise<BaselineData[]> {
  const latStr = lats.map(l => l.toFixed(4)).join(',');
  const lonStr = lons.map(l => l.toFixed(4)).join(',');
  const n = lats.length;

  if (forecastHour <= 0) {
    const [aqResp, wxResp] = await Promise.all([
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latStr}&longitude=${lonStr}&current=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&timezone=auto`),
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}&current=wind_speed_10m&timezone=auto`),
    ]);
    const aqJson = aqResp.ok ? await aqResp.json() : null;
    const wxJson = wxResp.ok ? await wxResp.json() : null;
    const aqArr = n === 1 ? [aqJson?.current] : (Array.isArray(aqJson) ? aqJson.map((r: Record<string, unknown>) => (r as Record<string, unknown>)?.current) : []);
    const wxArr = n === 1 ? [wxJson?.current] : (Array.isArray(wxJson) ? wxJson.map((r: Record<string, unknown>) => (r as Record<string, unknown>)?.current) : []);
    return lats.map((_, i) => ({
      pm25: (aqArr[i] as Record<string, number>)?.pm2_5 ?? 15,
      pm10: (aqArr[i] as Record<string, number>)?.pm10 ?? 25,
      no2: (aqArr[i] as Record<string, number>)?.nitrogen_dioxide ?? 10,
      co: (aqArr[i] as Record<string, number>)?.carbon_monoxide ?? 200,
      o3: (aqArr[i] as Record<string, number>)?.ozone ?? 30,
      wind_speed: (wxArr[i] as Record<string, number>)?.wind_speed_10m ?? 2.0,
    }));
  }

  const [aqResp, wxResp] = await Promise.all([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latStr}&longitude=${lonStr}&hourly=pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone&forecast_hours=${forecastHour + 1}&timezone=auto`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}&hourly=wind_speed_10m&forecast_hours=${forecastHour + 1}&timezone=auto`),
  ]);
  const aqJson = aqResp.ok ? await aqResp.json() : null;
  const wxJson = wxResp.ok ? await wxResp.json() : null;
  const aqArr = n === 1 ? [aqJson] : (Array.isArray(aqJson) ? aqJson : []);
  const wxArr = n === 1 ? [wxJson] : (Array.isArray(wxJson) ? wxJson : []);
  const idx = forecastHour;
  return lats.map((_, i) => ({
    pm25: (aqArr[i] as Record<string, Record<string, number[]>>)?.hourly?.pm2_5?.[idx] ?? 15,
    pm10: (aqArr[i] as Record<string, Record<string, number[]>>)?.hourly?.pm10?.[idx] ?? 25,
    no2: (aqArr[i] as Record<string, Record<string, number[]>>)?.hourly?.nitrogen_dioxide?.[idx] ?? 10,
    co: (aqArr[i] as Record<string, Record<string, number[]>>)?.hourly?.carbon_monoxide?.[idx] ?? 200,
    o3: (aqArr[i] as Record<string, Record<string, number[]>>)?.hourly?.ozone?.[idx] ?? 30,
    wind_speed: (wxArr[i] as Record<string, Record<string, number[]>>)?.hourly?.wind_speed_10m?.[idx] ?? 2.0,
  }));
}

function buildInterpolator(
  south: number, west: number, north: number, east: number,
  center: BaselineData, nw: BaselineData, ne: BaselineData,
  sw: BaselineData, se: BaselineData,
) {
  return (lat: number, lon: number): BaselineData => {
    const latSpan = north - south || 0.001;
    const lonSpan = east - west || 0.001;
    const ty = Math.max(0, Math.min(1, (lat - south) / latSpan));
    const tx = Math.max(0, Math.min(1, (lon - west) / lonSpan));

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
}

async function fetchBaselineGrid(south: number, west: number, north: number, east: number, forecastHour = 0) {
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;
  const qLat = Math.round(cLat * 10) / 10;
  const qLon = Math.round(cLon * 10) / 10;
  const OFFSET = 0.1;
  const baselineCacheKey = `vayu:bl:${qLat.toFixed(2)}:${qLon.toFixed(2)}:fh${forecastHour}`;
  const gS = qLat - OFFSET, gN = qLat + OFFSET;
  const gW = qLon - OFFSET, gE = qLon + OFFSET;

  const cachedBaseline = await redisGet(baselineCacheKey);
  if (cachedBaseline) {
    try {
      const { center, nw, ne, sw, se } = JSON.parse(cachedBaseline);
      const interpolate = buildInterpolator(gS, gW, gN, gE, center, nw, ne, sw, se);
      return { center, interpolate };
    } catch { /* fall through */ }
  }

  const lats = [qLat, gN, gN, gS, gS];
  const lons = [qLon, gW, gE, gW, gE];
  const results = await fetchBaselineBatch(lats, lons, forecastHour);
  const [center, nw, ne, sw, se] = results;
  await redisSetEx(baselineCacheKey, 900, JSON.stringify({ center, nw, ne, sw, se }));
  const interpolate = buildInterpolator(gS, gW, gN, gE, center, nw, ne, sw, se);
  return { center, interpolate };
}

// ─── WAQI bias correction (from road-aqi.ts) ────────────────
interface WAQIBias { pm25: number; pm10: number; no2: number; o3: number; stationName: string | null; }

function pm25AQIToUg(aqi: number): number {
  const bp = [ [0,50,0,12], [51,100,12.1,35.4], [101,150,35.5,55.4], [151,200,55.5,150.4], [201,300,150.5,250.4], [301,500,250.5,500.4] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return ((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo;
  }
  return 500;
}

function no2AQIToUg(aqi: number): number {
  const bp = [ [0,50,0,53], [51,100,54,100], [101,150,101,360], [151,200,361,649], [201,300,650,1249], [301,500,1250,2049] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return (((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo) * 1.88;
  }
  return 2049 * 1.88;
}

function o3AQIToUg(aqi: number): number {
  const bp = [ [0,50,0,54], [51,100,55,70], [101,150,71,85], [151,200,86,105], [201,300,106,200] ];
  for (const [aqiLo, aqiHi, cLo, cHi] of bp) {
    if (aqi <= aqiHi) return (((cHi - cLo) / (aqiHi - aqiLo)) * (aqi - aqiLo) + cLo) * 2.0;
  }
  return 200 * 2.0;
}

async function fetchWAQIBias(lat: number, lon: number, openMeteoBaseline: BaselineData): Promise<WAQIBias> {
  const noBias: WAQIBias = { pm25: 0, pm10: 0, no2: 0, o3: 0, stationName: null };
  const token = process.env.WAQI_TOKEN;
  if (!token) return noBias;

  const q = (v: number) => (Math.round(v * 20) / 20).toFixed(2);
  const cacheKey = `vayu:waqi:${q(lat)}:${q(lon)}`;
  const cached = await redisGet(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch { /* fall through */ } }

  try {
    const resp = await fetch(
      `https://api.waqi.info/feed/geo:${lat.toFixed(4)};${lon.toFixed(4)}/?token=${encodeURIComponent(token)}`
    );
    if (!resp.ok) return noBias;
    const json = await resp.json();
    if (json.status !== 'ok' || !json.data?.iaqi) return noBias;

    const iaqi = json.data.iaqi;
    const stationName: string = json.data.city?.name ?? null;
    const waqiPm25 = iaqi.pm25?.v != null ? pm25AQIToUg(iaqi.pm25.v) : null;
    const waqiNo2 = iaqi.no2?.v != null ? no2AQIToUg(iaqi.no2.v) : null;
    const waqiO3 = iaqi.o3?.v != null ? o3AQIToUg(iaqi.o3.v) : null;

    const clampBias = (observed: number | null, modeled: number): number => {
      if (observed == null) return 0;
      const raw = observed - modeled;
      const maxBias = Math.abs(modeled) * 0.5;
      return Math.max(-maxBias, Math.min(maxBias, raw));
    };

    const bias: WAQIBias = {
      pm25: clampBias(waqiPm25, openMeteoBaseline.pm25),
      pm10: 0,
      no2: clampBias(waqiNo2, openMeteoBaseline.no2),
      o3: clampBias(waqiO3, openMeteoBaseline.o3),
      stationName,
    };

    await redisSetEx(cacheKey, 3600, JSON.stringify(bias));
    return bias;
  } catch {
    return noBias;
  }
}

// ─── Supabase RPC: find_roads_along_route ───────────────────
async function findRoadsAlongRoute(routeGeoJson: string, bufferMeters = 30): Promise<RoadRow[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_roads_along_route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ route_geojson: routeGeoJson, buffer_meters: bufferMeters }),
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch { return []; }
}

// ─── Supabase RPC: find_through_gang_roads (topology-verified) ──
interface ThroughGangRoad {
  osm_way_id: number; geojson: string; highway: string;
  name: string | null; road_length_m: number;
  start_connections: number; end_connections: number;
}

async function findThroughGangRoads(
  south: number, west: number, north: number, east: number,
  roadLimit = 20, connectionDistanceM = 5.0,
): Promise<ThroughGangRoad[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_through_gang_roads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        south, west, north, east,
        road_limit: roadLimit,
        connection_distance_m: connectionDistanceM,
      }),
    });
    if (!resp.ok) {
      // Fallback to old bbox query if new RPC not deployed yet
      return await findGangRoadsInBBoxFallback(south, west, north, east);
    }
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 ? data : [];
  } catch {
    return await findGangRoadsInBBoxFallback(south, west, north, east);
  }
}

// Fallback: old bbox query (used if migration 007 not yet applied)
async function findGangRoadsInBBoxFallback(
  south: number, west: number, north: number, east: number,
): Promise<ThroughGangRoad[]> {
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
      body: JSON.stringify({
        south, west, north, east,
        road_limit: 10,
        simplify_tolerance: 0,
        highway_types: ['living_street', 'path', 'footway', 'pedestrian'],
      }),
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return (rows || []).map((r: Record<string, unknown>) => ({
      osm_way_id: r.osm_way_id as number,
      geojson: r.geojson as string,
      highway: r.highway as string,
      name: (r.name as string) ?? null,
      road_length_m: 0,
      start_connections: 1,
      end_connections: 1,
    }));
  } catch { return []; }
}

// ─── Open-Meteo fallback for single point ───────────────────
async function getPointAQI(lat: number, lon: number): Promise<{ aqi: number; pm25: number }> {
  try {
    const resp = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=auto`
    );
    if (!resp.ok) return { aqi: 50, pm25: 12 };
    const json = await resp.json();
    const pm25 = json.current?.pm2_5 ?? 12;
    return { aqi: pm25ToAQI(pm25), pm25 };
  } catch {
    return { aqi: 50, pm25: 12 };
  }
}

/** Sample N equidistant points from a polyline */
function samplePolyline(polyline: [number, number][], maxSamples: number): [number, number][] {
  if (polyline.length <= maxSamples) return polyline;
  const samples: [number, number][] = [polyline[0]];
  const step = (polyline.length - 1) / (maxSamples - 1);
  for (let i = 1; i < maxSamples - 1; i++) {
    const idx = Math.round(i * step);
    samples.push(polyline[idx]);
  }
  samples.push(polyline[polyline.length - 1]);
  return samples;
}

/** Simple hash for cache key from polyline endpoints + length */
function polylineHash(polyline: [number, number][]): string {
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  const mid = polyline[Math.floor(polyline.length / 2)];
  return `${first[0].toFixed(4)}_${first[1].toFixed(4)}_${last[0].toFixed(4)}_${last[1].toFixed(4)}_${mid[0].toFixed(4)}_${mid[1].toFixed(4)}_${polyline.length}`;
}

// ─── Exported scoring function (used by clean-route.ts too) ─
export interface RouteScoreV2Result {
  avg_aqi: number;
  max_aqi: number;
  min_aqi: number;
  combined_score: number;
  vehicle_type: string;
  segment_count: number;
  ai_enhanced: boolean;
  vayu_scored: boolean;
  baseline_pm25: number;
  baseline_no2: number;
  wind_speed: number;
  waqi_station: string | null;
  segments: Array<{
    osm_way_id: number;
    highway: string;
    name: string | null;
    aqi: number;
    pm25: number;
    no2: number;
    fraction_along: number;
  }>;
}

export async function scorePolyline(
  polyline: [number, number][],
  vehicleType = 'pedestrian',
  forecastHour = 0,
): Promise<RouteScoreV2Result> {
  // Build GeoJSON LineString (ORS uses [lng, lat], our polyline is [lat, lon])
  const geojsonCoords = polyline.map(([lat, lon]) => [lon, lat]);
  const geojson = JSON.stringify({
    type: 'LineString',
    coordinates: geojsonCoords,
  });

  // Find roads along route from Supabase
  const roads = await findRoadsAlongRoute(geojson, 30);

  // Compute route bbox from polyline
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [lat, lon] of polyline) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  // Pad bbox slightly
  const pad = 0.005;
  const south = minLat - pad, north = maxLat + pad;
  const west = minLon - pad, east = maxLon + pad;

  // Fetch baseline grid (Redis cached)
  const { center: baselineCenter, interpolate: interpBaseline } = await fetchBaselineGrid(south, west, north, east, forecastHour);

  // WAQI bias correction
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;
  const bias = await fetchWAQIBias(cLat, cLon, baselineCenter);

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

  const targetHour = (new Date().getHours() + forecastHour) % 24;
  const diurnal = HOURLY_TRAFFIC[targetHour] ?? 1.0;
  const weights = VEHICLE_WEIGHTS[vehicleType] || VEHICLE_WEIGHTS.pedestrian;

  if (roads.length === 0) {
    // Fallback: Open-Meteo baseline per-point (original behavior)
    const samples = samplePolyline(polyline, 20);
    const results = await Promise.all(
      samples.map(async ([lat, lon]) => {
        const r = await getPointAQI(lat, lon);
        return { lat, lon, aqi: r.aqi, pm25: r.pm25 };
      })
    );
    const aqiValues = results.map(r => r.aqi);
    const avgAqi = aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length;
    const aqiScore = avgAqi / 500;
    const timeScore = 0.5;
    return {
      avg_aqi: Math.round(avgAqi),
      max_aqi: Math.max(...aqiValues),
      min_aqi: Math.min(...aqiValues),
      combined_score: Math.round((weights.aqi * aqiScore + weights.time * timeScore) * 1000) / 1000,
      vehicle_type: vehicleType,
      segment_count: results.length,
      ai_enhanced: false,
      vayu_scored: false,
      baseline_pm25: baselineCenter.pm25,
      baseline_no2: baselineCenter.no2,
      wind_speed: baselineCenter.wind_speed,
      waqi_station: bias.stationName,
      segments: results.map((r, i) => ({
        osm_way_id: 0,
        highway: 'unknown',
        name: null,
        aqi: r.aqi,
        pm25: r.pm25,
        no2: 0,
        fraction_along: i / (results.length - 1 || 1),
      })),
    };
  }

  // Sub-sample if >500 segments to stay within time budget
  let scoredRoads = roads;
  if (roads.length > 500) {
    const step = Math.ceil(roads.length / 200);
    scoredRoads = roads.filter((_, i) => i === 0 || i === roads.length - 1 || i % step === 0);
  }

  // Score each road segment with VAYU Gaussian model
  const segments: RouteScoreV2Result['segments'] = [];
  let sumAqi = 0;
  let maxAqi = 0;
  let minAqi = Infinity;
  let aiEnhanced = false;

  for (const road of scoredRoads) {
    // Get road centroid for baseline interpolation
    let roadLat = cLat, roadLon = cLon;
    try {
      const coords = JSON.parse(road.geojson).coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      roadLon = mid[0]; roadLat = mid[1];
    } catch { /* use center */ }

    const baseline = interpCorrected(roadLat, roadLon);
    const result = computeRoadAQI(road, baseline, diurnal);

    if (road.ai_pollution_factor != null || road.micro_class != null) aiEnhanced = true;

    sumAqi += result.aqi;
    if (result.aqi > maxAqi) maxAqi = result.aqi;
    if (result.aqi < minAqi) minAqi = result.aqi;

    segments.push({
      osm_way_id: road.osm_way_id,
      highway: road.highway,
      name: road.name,
      aqi: result.aqi,
      pm25: result.pm25,
      no2: result.no2,
      fraction_along: road.fraction_along,
    });
  }

  const avgAqi = Math.round(sumAqi / segments.length);
  const aqiScore = avgAqi / 500;
  const timeScore = 0.5;

  return {
    avg_aqi: avgAqi,
    max_aqi: maxAqi,
    min_aqi: minAqi === Infinity ? 0 : minAqi,
    combined_score: Math.round((weights.aqi * aqiScore + weights.time * timeScore) * 1000) / 1000,
    vehicle_type: vehicleType,
    segment_count: segments.length,
    ai_enhanced: aiEnhanced,
    vayu_scored: true,
    baseline_pm25: baselineCenter.pm25,
    baseline_no2: baselineCenter.no2,
    wind_speed: baselineCenter.wind_speed,
    waqi_station: bias.stationName,
    segments,
  };
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // ── Mode: Clean-route orchestrator (when start+end provided) ──
  if (body.start && body.end) {
    return handleCleanRoute(req, res);
  }

  // ── Mode: Score a single polyline ──
  if (!body.polyline || !Array.isArray(body.polyline) || body.polyline.length < 2) {
    return res.status(400).json({ error: 'polyline (array of [lat,lon] pairs) required, min 2 points' });
  }
  if (body.polyline.length > 5000) {
    return res.status(400).json({ error: 'polyline too long, max 5000 points' });
  }

  const vehicleType = body.vehicle_type || 'pedestrian';
  const forecastHour = Math.max(0, Math.min(24, body.forecast_hour || 0));

  try {
    const hash = polylineHash(body.polyline);
    const cacheKey = `vayu:rsv2:${hash}:${vehicleType}:fh${forecastHour}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cached));
    }

    const data = await scorePolyline(body.polyline, vehicleType, forecastHour);

    const payload = { data };
    await redisSetEx(cacheKey, 300, JSON.stringify(payload));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(payload);
  } catch (error) {
    console.error('VAYU route-score-v2 error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEAN-ROUTE ORCHESTRATOR
// ORS alternatives → VAYU scoring (parallel) → Gemini ranking
// DEMO-SAFE: Always returns 200 with { routes: [], meta } on error
// ═══════════════════════════════════════════════════════════════

interface ORSRoute {
  summary: { distance: number; duration: number };
  geometry: number[][];
  segments: Array<{
    steps: Array<{
      instruction: string;
      distance: number;
      duration: number;
      type: number;
      way_points: number[];
    }>;
  }>;
}

function orsToPolyline(coords: number[][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng]);
}

function orsToWaypoints(coords: number[][]): Array<{ lat: number; lng: number }> {
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

// ─── Haversine distance in meters (for geometry similarity) ─
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSimilarGeometry(coords1: number[][], coords2: number[][], thresholdMeters = 40): boolean {
  const n = 5;
  let totalDev = 0;
  for (let i = 0; i < n; i++) {
    const idx1 = Math.min(Math.floor((i / n) * coords1.length), coords1.length - 1);
    const idx2 = Math.min(Math.floor((i / n) * coords2.length), coords2.length - 1);
    const [lng1, lat1] = coords1[idx1];
    const [lng2, lat2] = coords2[idx2];
    totalDev += haversineMeters(lat1, lng1, lat2, lng2);
  }
  return (totalDev / n) < thresholdMeters;
}

function getPerpendicularPoint(
  start: [number, number], end: [number, number], offsetMeters: number,
): [number, number] {
  const dLng = end[0] - start[0];
  const dLat = end[1] - start[1];
  const length = Math.sqrt(dLng * dLng + dLat * dLat) || 0.0001;
  const perpLng = -dLat / length;
  const perpLat = dLng / length;
  const degPerMeter = 1 / 111320;
  return [
    (start[0] + end[0]) / 2 + perpLng * offsetMeters * degPerMeter,
    (start[1] + end[1]) / 2 + perpLat * offsetMeters * degPerMeter,
  ];
}

async function doORSRequest(
  coordinates: [number, number][],
  profile: string, apiKey: string,
  altParams?: { share_factor: number; target_count: number; weight_factor: number },
): Promise<ORSRoute[]> {
  const body: Record<string, unknown> = { coordinates, instructions: true, geometry: true };
  if (altParams) body.alternative_routes = altParams;

  const resp = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ORS ${resp.status}: ${text.slice(0, 200)}`);
  }

  const geojson = await resp.json();
  return (geojson.features || []).map((f: Record<string, unknown>) => {
    const props = f.properties as Record<string, unknown>;
    const geom = f.geometry as { coordinates: number[][] };
    return {
      summary: props.summary as { distance: number; duration: number },
      geometry: geom.coordinates,
      segments: (props.segments || []) as ORSRoute['segments'],
    };
  });
}

async function fetchORSAlternatives(
  start: [number, number], end: [number, number],
  profile: string, targetCount: number,
): Promise<ORSRoute[]> {
  const apiKey = process.env.VITE_OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY;
  if (!apiKey) throw new Error('ORS API key not configured');

  // First attempt — strict params (diverse routes)
  let routes = await doORSRequest([start, end], profile, apiKey, {
    share_factor: 0.4, target_count: targetCount, weight_factor: 1.8,
  });

  // If not enough, retry with relaxed params
  if (routes.length < targetCount) {
    try {
      const relaxed = await doORSRequest([start, end], profile, apiKey, {
        share_factor: 0.8, target_count: targetCount, weight_factor: 3.0,
      });
      for (const r of relaxed) {
        if (!routes.some(existing => isSimilarGeometry(existing.geometry, r.geometry, 40))) {
          routes.push(r);
        }
      }
    } catch { /* skip relaxed retry */ }
  }

  // If still < 2, generate alternatives via perpendicular waypoints
  if (routes.length < 2) {
    const dist = haversineMeters(start[1], start[0], end[1], end[0]);
    const offsets = [Math.min(300, dist * 0.3), -Math.min(300, dist * 0.3)];
    for (const offset of offsets) {
      if (routes.length >= targetCount) break;
      try {
        const wp = getPerpendicularPoint(start, end, offset);
        const altRoutes = await doORSRequest([start, wp, end], profile, apiKey);
        const alt = altRoutes[0];
        if (alt && !routes.some(existing => isSimilarGeometry(existing.geometry, alt.geometry, 40))) {
          routes.push(alt);
        }
      } catch { /* skip this waypoint */ }
    }
  }

  return routes;
}

interface GeminiRanking { ranking: number[]; reasoning: string; labels: string[]; }

async function rankWithGemini(
  routes: Array<{
    index: number; distance_meters: number; duration_seconds: number;
    avg_aqi: number; max_aqi: number; min_aqi: number;
    segment_count: number; worst_segments: string[]; best_segments: string[];
  }>,
): Promise<GeminiRanking | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const summaries = routes.map((r) =>
    `Route ${r.index + 1}: ${r.distance_meters}m, ${Math.round(r.duration_seconds / 60)}min, ` +
    `avg AQI ${r.avg_aqi}, max AQI ${r.max_aqi}, ${r.segment_count} segments. ` +
    `Worst: ${r.worst_segments.join(', ') || 'none'}. Best: ${r.best_segments.join(', ') || 'none'}.`
  ).join('\n');

  const prompt = `You are a route-ranking AI for a clean-air navigation app. Given ${routes.length} walking routes with per-road air quality data, rank them from cleanest to most polluted.\n\n${summaries}\n\nRespond with ONLY valid JSON (no markdown, no backticks):\n{"ranking":[1-indexed route numbers best to worst],"reasoning":"2-3 sentence explanation of why the best route is cleanest, mentioning specific roads if possible","labels":["cleanest","balanced","fastest" for each route in order of ranking]}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const json = await resp.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.ranking || !Array.isArray(parsed.ranking)) return null;
    return parsed as GeminiRanking;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

function estimateTrafficLevel(avgAqi: number): string {
  if (avgAqi <= 40) return 'low';
  if (avgAqi <= 70) return 'moderate';
  if (avgAqi <= 120) return 'high';
  return 'very-high';
}

function estimateGreenScore(segments: Array<{ highway: string; aqi: number }>): number {
  if (segments.length === 0) return 50;
  const greenTypes = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'living_street']);
  const greenCount = segments.filter(s => greenTypes.has(s.highway) || s.aqi <= 35).length;
  return Math.round((greenCount / segments.length) * 100);
}

async function handleCleanRoute(req: VercelRequest, res: VercelResponse) {
  const emptyResponse = (error?: string) => ({
    routes: [],
    meta: { vayu_scored: false, gemini_used: false, response_ms: 0, error },
  });

  const startTime = Date.now();

  try {
    const body = req.body || {};
    const { start, end, profile = 'foot-walking', alternatives = 3 } = body;

    let startLat: number, startLng: number, endLat: number, endLng: number;
    if (Array.isArray(start)) {
      [startLat, startLng] = start;
    } else {
      startLat = start.lat; startLng = start.lng;
    }
    if (Array.isArray(end)) {
      [endLat, endLng] = end;
    } else {
      endLat = end.lat; endLng = end.lng;
    }

    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(200).json(emptyResponse('Invalid coordinates'));
    }

    // ORS expects [lng, lat]
    const orsStart: [number, number] = [startLng, startLat];
    const orsEnd: [number, number] = [endLng, endLat];

    // ── Phase 2: Parallel fetch — ORS alternatives + through-gang-roads ──
    const bufferDeg = 0.003;
    const corridorSouth = Math.min(startLat, endLat) - bufferDeg;
    const corridorNorth = Math.max(startLat, endLat) + bufferDeg;
    const corridorWest = Math.min(startLng, endLng) - bufferDeg;
    const corridorEast = Math.max(startLng, endLng) + bufferDeg;

    const [orsRoutes, throughRoads] = await Promise.all([
      fetchORSAlternatives(orsStart, orsEnd, profile, alternatives).catch((e) => {
        console.error('ORS error:', e);
        return [] as ORSRoute[];
      }),
      findThroughGangRoads(corridorSouth, corridorWest, corridorNorth, corridorEast).catch(() => [] as ThroughGangRoad[]),
    ]);

    if (orsRoutes.length === 0) {
      return res.status(200).json(emptyResponse('no_routes_found'));
    }

    // Helper: convert ORS route to scored entry
    const orsToScoredEntry = async (ors: ORSRoute, index: number) => {
      const polyline = orsToPolyline(ors.geometry);
      const waypoints = orsToWaypoints(ors.geometry);
      let score;
      try {
        score = await scorePolyline(polyline, 'pedestrian', 0);
      } catch (e) {
        console.error(`VAYU scoring failed for route ${index}:`, e);
        score = null;
      }
      const instructions = ors.segments.flatMap((seg) =>
        seg.steps.map((step) => ({
          text: step.instruction, distance: step.distance,
          duration: step.duration, type: step.type,
          waypoint_index: step.way_points[0] ?? 0,
        }))
      );
      return { index, polyline: waypoints, distance_meters: Math.round(ors.summary.distance), duration_seconds: Math.round(ors.summary.duration), instructions, score };
    };

    // Score ORS routes
    const scoredRoutes = await Promise.all(
      orsRoutes.map((ors, index) => orsToScoredEntry(ors, index))
    );

    // ── Phase 2: Multi-corridor gang road injection ──
    const gangTypes = new Set(['living_street', 'path', 'footway', 'pedestrian']);
    const hasGangRoute = scoredRoutes.some((r) => {
      const segs = r.score?.segments || [];
      if (segs.length === 0) return false;
      const gangCount = segs.filter((s) => gangTypes.has(s.highway)).length;
      return gangCount / segs.length >= 0.25;
    });

    if (!hasGangRoute && throughRoads.length > 0) {
      try {
        const midLat = (startLat + endLat) / 2;
        const midLng = (startLng + endLng) / 2;
        const travelBearing = Math.atan2(endLng - startLng, endLat - startLat);

        // Score and rank through-roads
        const rankedGangRoads = throughRoads
          .map(gr => {
            try {
              const coords = JSON.parse(gr.geojson).coordinates;
              if (coords.length < 2) return null;
              let len = gr.road_length_m || 0;
              if (len === 0) {
                for (let i = 1; i < coords.length; i++) {
                  len += haversineMeters(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
                }
              }
              const first = coords[0];
              const last = coords[coords.length - 1];
              const roadBearing = Math.atan2(last[0] - first[0], last[1] - first[1]);
              const angleDiff = Math.abs(travelBearing - roadBearing);
              const alignment = Math.abs(Math.cos(angleDiff));
              const mid = coords[Math.floor(coords.length / 2)];
              const distToMid = haversineMeters(midLat, midLng, mid[1], mid[0]);
              const connScore = Math.min((gr.start_connections + gr.end_connections) / 6, 1);
              const score = (Math.min(len, 200) / 200) * 0.3
                          + alignment * 0.25
                          + (1 - Math.min(distToMid, 500) / 500) * 0.25
                          + connScore * 0.2;
              return { ...gr, coords, len, score, mid };
            } catch { return null; }
          })
          .filter((gr): gr is NonNullable<typeof gr> => gr !== null && gr.len > 30)
          .sort((a, b) => b.score - a.score);

        // Take top 2 gang roads for multi-corridor routing
        const topGangRoads = rankedGangRoads.slice(0, 2);
        const orsApiKey = process.env.VITE_OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY;

        if (topGangRoads.length > 0 && orsApiKey) {
          // Generate ORS routes through each gang road IN PARALLEL
          const gangRouteResults = await Promise.all(
            topGangRoads.map(async (gr) => {
              try {
                const gangWp: [number, number] = [gr.mid[0], gr.mid[1]];
                const orsResult = await doORSRequest([orsStart, gangWp, orsEnd], profile, orsApiKey);
                return orsResult[0] || null;
              } catch { return null; }
            })
          );

          // Score and validate gang routes
          const shortestDuration = Math.min(...scoredRoutes.map(r => r.duration_seconds));
          for (const gangRoute of gangRouteResults) {
            if (!gangRoute) continue;
            // Dedup check against existing routes
            if (scoredRoutes.some((r) =>
              isSimilarGeometry(gangRoute.geometry, r.polyline.map((p) => [p.lng, p.lat]), 40)
            )) continue;

            const gangEntry = await orsToScoredEntry(gangRoute, scoredRoutes.length);

            // Backtracking rejection: duration > 1.4× shortest
            if (gangEntry.duration_seconds > shortestDuration * 1.4) {
              console.log('[clean-route] Gang route rejected: duration ratio',
                (gangEntry.duration_seconds / shortestDuration).toFixed(2));
              continue;
            }

            const gangAvgAqi = gangEntry.score?.avg_aqi ?? 999;
            if (scoredRoutes.length < 5) {
              // Room for more candidates — add it
              scoredRoutes.push(gangEntry);
            } else {
              // Replace worst-AQI route if this is cleaner
              const worstIdx = scoredRoutes.reduce((wi, r, i) =>
                (r.score?.avg_aqi ?? 0) > (scoredRoutes[wi].score?.avg_aqi ?? 0) ? i : wi, 0);
              const worstAqi = scoredRoutes[worstIdx].score?.avg_aqi ?? 0;
              if (gangAvgAqi < worstAqi) {
                scoredRoutes[worstIdx] = { ...gangEntry, index: scoredRoutes[worstIdx].index };
              }
            }
          }
        }
      } catch (e) {
        console.error('[clean-route] Multi-corridor injection failed:', e);
      }
    }

    const geminiInput = scoredRoutes.map((r) => {
      const segments = r.score?.segments || [];
      const sortedByAqi = [...segments].sort((a, b) => b.aqi - a.aqi);
      return {
        index: r.index, distance_meters: r.distance_meters, duration_seconds: r.duration_seconds,
        avg_aqi: r.score?.avg_aqi ?? 50, max_aqi: r.score?.max_aqi ?? 50, min_aqi: r.score?.min_aqi ?? 50,
        segment_count: r.score?.segment_count ?? 0,
        worst_segments: sortedByAqi.slice(0, 3).map(s => `${s.name || s.highway} (AQI ${s.aqi})`),
        best_segments: sortedByAqi.slice(-3).reverse().map(s => `${s.name || s.highway} (AQI ${s.aqi})`),
      };
    });

    // Fix A: Always use metric-based labels. Gemini only provides reasoning text.
    let reasoning: string | null = null;
    try {
      const geminiResult = await rankWithGemini(geminiInput);
      reasoning = geminiResult?.reasoning ?? null;
    } catch { /* skip */ }

    // Assign labels based on actual metrics: fastest=shortest duration, cleanest=lowest AQI
    const byDuration = [...scoredRoutes].sort((a, b) => a.duration_seconds - b.duration_seconds);
    const byAqi = [...scoredRoutes].sort((a, b) => (a.score?.avg_aqi ?? 999) - (b.score?.avg_aqi ?? 999));
    const usedIndices = new Set<number>();

    const fastestRoute = byDuration[0];
    usedIndices.add(fastestRoute.index);

    const cleanestRoute = byAqi.find((r) => !usedIndices.has(r.index)) || byAqi[0];
    usedIndices.add(cleanestRoute.index);

    const balancedRoute = scoredRoutes.find((r) => !usedIndices.has(r.index)) || scoredRoutes[0];

    const labeled: Array<typeof scoredRoutes[0] & { label: 'cleanest' | 'balanced' | 'fastest'; reasoning: string | null }> = [
      { ...cleanestRoute, label: 'cleanest' as const, reasoning },
      { ...balancedRoute, label: 'balanced' as const, reasoning },
      { ...fastestRoute, label: 'fastest' as const, reasoning },
    ];

    const routes = labeled.map((r) => ({
      polyline: r.polyline, distance_meters: r.distance_meters, duration_seconds: r.duration_seconds, instructions: r.instructions,
      vayu_avg_aqi: r.score?.avg_aqi ?? 50, vayu_max_aqi: r.score?.max_aqi ?? 50,
      vayu_segment_count: r.score?.segment_count ?? 0, vayu_scored: r.score?.vayu_scored ?? false,
      route_label: r.label, gemini_reasoning: r.reasoning,
      segments: (r.score?.segments || []).map((s) => ({
        osm_way_id: s.osm_way_id, highway: s.highway, name: s.name,
        aqi: s.aqi, pm25: s.pm25, no2: s.no2, fraction_along: s.fraction_along,
      })),
      traffic_level: estimateTrafficLevel(r.score?.avg_aqi ?? 50),
      green_score: estimateGreenScore(r.score?.segments || []),
    }));

    const responseMs = Date.now() - startTime;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      routes,
      meta: { vayu_scored: routes.some(r => r.vayu_scored), gemini_used: reasoning !== null, response_ms: responseMs },
    });
  } catch (error) {
    console.error('Clean-route error:', error);
    return res.status(200).json({
      routes: [],
      meta: { vayu_scored: false, gemini_used: false, response_ms: Date.now() - startTime, error: error instanceof Error ? error.message : 'unknown_error' },
    });
  }
}
