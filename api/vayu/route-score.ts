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

// ─── Region detection (for Module B/C corrections) ──────────
function detectRegion(lat: number, lon: number): string {
  if (lat >= -8.85 && lat <= -8.06 && lon >= 114.43 && lon <= 115.71) return 'bali';
  if (lat >= -6.50 && lat <= -6.08 && lon >= 106.60 && lon <= 107.10) return 'jakarta';
  if (lat >= -7.02 && lat <= -6.82 && lon >= 107.45 && lon <= 107.77) return 'bandung';
  if (lat >= -7.40 && lat <= -7.15 && lon >= 112.55 && lon <= 112.85) return 'surabaya';
  if (lat >= -7.10 && lat <= -6.90 && lon >= 110.30 && lon <= 110.50) return 'semarang';
  if (lat >= -7.87 && lat <= -7.72 && lon >= 110.30 && lon <= 110.50) return 'yogyakarta';
  return 'default';
}

// ─── Sentinel-5P Satellite NO₂ correction ───────────────────
interface SatelliteNO2Grid {
  grid: number[];
  rows: number;
  cols: number;
  bounds: { south: number; west: number; north: number; east: number };
}

async function fetchSatelliteNO2(
  south: number, west: number, north: number, east: number,
): Promise<((lat: number, lon: number) => number) | null> {
  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const q = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
  const cacheKey = `vayu:sat:no2:${q(south)}:${q(west)}:${q(north)}:${q(east)}`;

  let gridData: SatelliteNO2Grid | null = null;
  const cached = await redisGet(cacheKey);
  if (cached) {
    try { gridData = JSON.parse(cached); } catch { /* fall through */ }
  }

  if (!gridData) {
    try {
      const tokenResp = await fetch(
        'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );
      if (!tokenResp.ok) return null;
      const { access_token } = await tokenResp.json();

      const to = new Date();
      const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);

      const processResp = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          input: {
            bounds: {
              bbox: [west, south, east, north],
              properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
            },
            data: [{
              type: 'sentinel-5p-l2',
              dataFilter: {
                timeRange: { from: from.toISOString(), to: to.toISOString() },
                mosaickingOrder: 'mostRecent',
              },
            }],
          },
          output: {
            width: 8, height: 8,
            responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
          },
          evalscript: `//VERSION=3
function setup() {
  return { input: [{ bands: ["NO2","dataMask"], units: "DN" }], output: { bands: 1, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [NaN];
  return [s.NO2 * 1e6];
}`,
        }),
      });

      if (processResp.ok) {
        const buffer = await processResp.arrayBuffer();
        const floatView = new Float32Array(buffer, buffer.byteLength - 8 * 8 * 4, 64);
        const grid: number[] = [];
        for (let i = 0; i < floatView.length; i++) {
          grid.push(isNaN(floatView[i]) || floatView[i] <= 0 ? -1 : floatView[i]);
        }
        if (grid.some((v) => v > 0)) {
          gridData = { grid, rows: 8, cols: 8, bounds: { south, west, north, east } };
          await redisSetEx(cacheKey, 43200, JSON.stringify(gridData));
        }
      }
    } catch {
      return null;
    }
  }

  if (!gridData || gridData.grid.every((v) => v <= 0)) return null;

  const { grid, rows, cols, bounds } = gridData;
  const valid = grid.filter((v) => v > 0);
  if (valid.length === 0) return null;
  const gridMean = valid.reduce((a, b) => a + b, 0) / valid.length;

  return (lat: number, lon: number): number => {
    const latSpan = bounds.north - bounds.south || 0.01;
    const lonSpan = bounds.east - bounds.west || 0.01;
    const fy = Math.max(0, Math.min(rows - 1, ((lat - bounds.south) / latSpan) * (rows - 1)));
    const fx = Math.max(0, Math.min(cols - 1, ((lon - bounds.west) / lonSpan) * (cols - 1)));
    const y0 = Math.floor(fy), x0 = Math.floor(fx);
    const y1 = Math.min(rows - 1, y0 + 1), x1 = Math.min(cols - 1, x0 + 1);
    const ty = fy - y0, tx = fx - x0;
    const get = (r: number, c: number) => {
      const v = grid[r * cols + c];
      return v > 0 ? v : gridMean;
    };
    const bilinear = get(y0, x0) * (1 - tx) * (1 - ty) + get(y0, x1) * tx * (1 - ty) +
                     get(y1, x0) * (1 - tx) * ty + get(y1, x1) * tx * ty;
    return Math.max(0.7, Math.min(1.5, bilinear / gridMean));
  };
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
  fraction_along?: number | null;
}

interface BaselineData {
  pm25: number; pm10: number; no2: number;
  co: number; o3: number; wind_speed: number;
}

interface RoadAQIComputation {
  aqi: number;
  pm25: number;
  no2: number;
  o3: number;
  pm10: number;
  pm25_delta: number;
  no2_delta: number;
}

interface CorridorRoadScore {
  road: RoadRow;
  midpoint: [number, number];
  progress: number;
  length_m: number;
  score: RoadAQIComputation;
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
): RoadAQIComputation {
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
    pm25_delta: Math.round(pm25Delta * 1000) / 1000,
    no2_delta: Math.round(no2Delta * 1000) / 1000,
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

async function findRoadsInBBox(
  south: number,
  west: number,
  north: number,
  east: number,
  roadLimit = 500,
  highwayTypes: string[] | null = null,
): Promise<RoadRow[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  const body: Record<string, unknown> = {
    south,
    west,
    north,
    east,
    road_limit: roadLimit,
    simplify_tolerance: 0,
  };
  if (highwayTypes && highwayTypes.length > 0) body.highway_types = highwayTypes;

  const headers = {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };

  try {
    let resp = await fetch(`${url}/rest/v1/rpc/find_roads_in_bbox`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok && body.highway_types) {
      const fallbackBody = { ...body } as Record<string, unknown>;
      delete fallbackBody.highway_types;
      resp = await fetch(`${url}/rest/v1/rpc/find_roads_in_bbox`, {
        method: 'POST',
        headers,
        body: JSON.stringify(fallbackBody),
      });
    }

    if (!resp.ok) return [];
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({ ...(row as RoadRow), fraction_along: null }));
  } catch {
    return [];
  }
}

// ─── Supabase RPC: find_through_gang_roads (topology-verified) ──
// B1 fix shipped to DB: connection_distance default 3.0m, length>40m, sum_conn>=3.
// B1 fix to interface: + start_lng/start_lat/end_lng/end_lat so caller can pick
// endpoint-aligned-to-destination (B2) instead of midpoint.
interface ThroughGangRoad {
  osm_way_id: number; geojson: string; highway: string;
  name: string | null; road_length_m: number;
  start_connections: number; end_connections: number;
  start_lng: number; start_lat: number;
  end_lng: number; end_lat: number;
}

async function findThroughGangRoads(
  south: number, west: number, north: number, east: number,
  roadLimit = 20, connectionDistanceM = 3.0,  // B1: default tightened 5→3
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
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 ? data : [];
  } catch {
    return [];
  }
}

// ─── Supabase RPC: find_aqi_optimal_route (pgRouting graph pathfinder) ──
interface GraphRouteEdge {
  seq: number;
  osm_way_id: number;
  highway: string;
  name: string | null;
  length_m: number;
  aqi_cost: number;
  geojson: string;
}

async function findGraphOptimalRoute(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
): Promise<GraphRouteEdge[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_aqi_optimal_route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        start_lat: startLat,
        start_lng: startLng,
        end_lat: endLat,
        end_lng: endLng,
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ─── Tier 2 M1: find_aqi_optimal_route_v2 (multi-criteria slider) ──
interface GraphRouteEdgeV2 {
  seq: number;
  edge_id: number;
  osm_way_id: number;
  length_m: number;
  time_s: number;
  pm25_proxy: number;
  haber_dose: number;
  cost: number;
  agg_cost: number;
  geojson: string; // ST_AsGeoJSON(geom) stringified GeoJSON LineString
}

async function findAqiOptimalRouteV2(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
  aqiWeight: number,
  startHour?: number,
): Promise<GraphRouteEdgeV2[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/find_aqi_optimal_route_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        start_lat: startLat, start_lng: startLng,
        end_lat: endLat, end_lng: endLng,
        aqi_weight: Math.max(0, Math.min(1, aqiWeight)),
        start_hour: startHour ?? null,
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ─── Tier 2 M3: GNN-PPO sidecar (dark-launch) ─────────────────
interface PpoSidecarResponse {
  polyline: number[][]; // [lng, lat] pairs
  n_vertices: number;
}

async function callPpoSidecar(
  startLat: number, startLng: number,
  endLat: number, endLng: number,
): Promise<PpoSidecarResponse | null> {
  const url = process.env.GNN_PPO_SIDECAR_URL;
  if (!url || process.env.GNN_PPO_ENABLED !== '1') return null;
  try {
    const resp = await fetch(`${url.replace(/\/$/, '')}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_lat: startLat, start_lng: startLng, end_lat: endLat, end_lng: endLng }),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    if (!Array.isArray(j.polyline) || j.polyline.length < 2) return null;
    return j as PpoSidecarResponse;
  } catch {
    return null;
  }
}

async function logShadowEval(payload: {
  start_lat: number; start_lng: number; end_lat: number; end_lng: number;
  region?: string | null;
  user_aqi_weight: number | null;
  haversine_m: number;
  m1?: { distance_m: number; duration_s: number; avg_aqi: number; length_weighted_aqi: number; haber_dose: number; polyline: number[][] } | null;
  m3?: { distance_m: number; duration_s: number; avg_aqi: number; length_weighted_aqi: number; haber_dose: number; polyline: number[][] } | null;
  shown_to_user: 'm1' | 'm3' | 'tie';
  model_version_m3?: string;
}): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/shadow_routing_evals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        start_lat: payload.start_lat, start_lng: payload.start_lng,
        end_lat: payload.end_lat, end_lng: payload.end_lng,
        region: payload.region ?? null,
        user_aqi_weight: payload.user_aqi_weight,
        haversine_m: payload.haversine_m,
        m1_distance_m: payload.m1?.distance_m ?? null,
        m1_duration_s: payload.m1?.duration_s ?? null,
        m1_avg_aqi: payload.m1?.avg_aqi ?? null,
        m1_length_weighted_aqi: payload.m1?.length_weighted_aqi ?? null,
        m1_haber_dose: payload.m1?.haber_dose ?? null,
        m1_polyline: payload.m1?.polyline ?? null,
        m3_distance_m: payload.m3?.distance_m ?? null,
        m3_duration_s: payload.m3?.duration_s ?? null,
        m3_avg_aqi: payload.m3?.avg_aqi ?? null,
        m3_length_weighted_aqi: payload.m3?.length_weighted_aqi ?? null,
        m3_haber_dose: payload.m3?.haber_dose ?? null,
        m3_polyline: payload.m3?.polyline ?? null,
        shown_to_user: payload.shown_to_user,
        model_version_m3: payload.model_version_m3 ?? null,
      }),
    });
  } catch {
    // Shadow eval logging must never break the user request.
  }
}

// ─── Tier 2 M2: forecast_route_exposure ───────────────────────
interface RouteForecastSegment {
  segment_index: number;
  arrival_offset_s: number;
  arrival_hour: number;
  segment_pm25: number;
  segment_aqi: number;
  segment_length_m: number;
}

async function forecastRouteExposure(
  polyline: [number, number][],     // [lng, lat]
  startAt?: string,
): Promise<RouteForecastSegment[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || polyline.length < 2) return [];
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/forecast_route_exposure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        polyline: polyline,
        start_at: startAt ?? new Date().toISOString(),
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
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

/** Hash for cache key from polyline waypoints. Samples every 20th coord (plus
 * endpoints) so that two ORS alternatives with the same start/end/length but
 * different geometry don't collide on the same cache entry. */
function polylineHash(polyline: [number, number][]): string {
  if (polyline.length === 0) return 'empty';
  const parts: string[] = [];
  const step = Math.max(1, Math.floor(polyline.length / 20));
  for (let i = 0; i < polyline.length; i += step) {
    const p = polyline[i];
    parts.push(`${p[0].toFixed(4)},${p[1].toFixed(4)}`);
  }
  const last = polyline[polyline.length - 1];
  parts.push(`${last[0].toFixed(4)},${last[1].toFixed(4)}`);
  return `${parts.join('|')}_${polyline.length}`;
}

function parseLineCoords(geojson: string): number[][] {
  try {
    const parsed = JSON.parse(geojson) as { coordinates?: number[][] };
    return Array.isArray(parsed.coordinates) ? parsed.coordinates : [];
  } catch {
    return [];
  }
}

function roadMidpoint(coords: number[][]): [number, number] {
  const mid = coords[Math.floor(coords.length / 2)] || coords[0] || [0, 0];
  return [mid[0], mid[1]];
}

function lineLengthMeters(coords: number[][]): number {
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) {
    total += haversineMeters(coords[index - 1][1], coords[index - 1][0], coords[index][1], coords[index][0]);
  }
  return total;
}

function projectProgressOnLine(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  lat: number,
  lng: number,
): number {
  const ax = endLng - startLng;
  const ay = endLat - startLat;
  const denom = ax * ax + ay * ay;
  if (denom === 0) return 0.5;
  const projection = ((lng - startLng) * ax + (lat - startLat) * ay) / denom;
  return Math.max(0, Math.min(1, projection));
}

function buildSquareAvoidPolygon(lng: number, lat: number, radiusMeters: number): number[][][] {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.2));
  return [[
    [lng - lonDelta, lat - latDelta],
    [lng + lonDelta, lat - latDelta],
    [lng + lonDelta, lat + latDelta],
    [lng - lonDelta, lat + latDelta],
    [lng - lonDelta, lat - latDelta],
  ]];
}

const DIRTY_AQI_THRESHOLD = 120;
const MAX_AVOID_POLYGONS = 3;
const MIN_ROAD_LENGTH_TO_AVOID = 200;

function isOnDirectCorridor(
  roadCoords: number[][],
  start: [number, number],
  end: [number, number],
): boolean {
  if (roadCoords.length === 0) return false;
  const roadMid = roadCoords[Math.floor(roadCoords.length / 2)] || roadCoords[0];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return false;

  const t = Math.max(0, Math.min(1,
    ((roadMid[0] - start[0]) * dx + (roadMid[1] - start[1]) * dy) / lenSq
  ));
  const projLng = start[0] + t * dx;
  const projLat = start[1] + t * dy;
  const distM = haversineMeters(roadMid[1], roadMid[0], projLat, projLng);
  return distM < 80;
}

function buildAvoidPolygons(
  roads: CorridorRoadScore[],
  start: [number, number],
  end: [number, number],
): { type: 'MultiPolygon'; coordinates: number[][][][] } | null {
  const candidates = roads
    .filter((road) => !['footway', 'path', 'pedestrian', 'cycleway', 'living_street'].includes(road.road.highway))
    .filter((road) => road.score.aqi >= DIRTY_AQI_THRESHOLD)
    .filter((road) => road.length_m >= MIN_ROAD_LENGTH_TO_AVOID)
    .filter((road) => road.progress >= 0.1 && road.progress <= 0.9)
    .filter((road) => {
      const coords = parseLineCoords(road.road.geojson);
      if (isOnDirectCorridor(coords, start, end)) {
        console.log(`[avoid] Skipping corridor road: ${road.road.name || road.road.highway} (AQI ${road.score.aqi}) — on direct path`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score.aqi - a.score.aqi)
    .slice(0, MAX_AVOID_POLYGONS);

  if (candidates.length === 0) return null;
  return {
    type: 'MultiPolygon',
    coordinates: candidates.map((road) => {
      const [lng, lat] = road.midpoint;
      return buildSquareAvoidPolygon(lng, lat, 28);
    }),
  };
}

async function scoreCorridorRoads(
  roads: RoadRow[],
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  south: number,
  west: number,
  north: number,
  east: number,
  forecastHour = 0,
): Promise<CorridorRoadScore[]> {
  if (roads.length === 0) return [];

  const { center: baselineCenter, interpolate: interpBaseline } = await fetchBaselineGrid(south, west, north, east, forecastHour);
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;
  const [bias, satNO2Interp] = await Promise.all([
    fetchWAQIBias(cLat, cLon, baselineCenter),
    fetchSatelliteNO2(south, west, north, east).catch(() => null),
  ]);

  const interpCorrected = (lat: number, lon: number): BaselineData => {
    const raw = interpBaseline(lat, lon);
    let correctedNO2 = Math.max(0, raw.no2 + bias.no2);
    if (satNO2Interp) correctedNO2 *= satNO2Interp(lat, lon);
    return {
      ...raw,
      pm25: Math.max(0, raw.pm25 + bias.pm25),
      pm10: Math.max(0, raw.pm10 + bias.pm10),
      no2: correctedNO2,
      o3: Math.max(0, raw.o3 + bias.o3),
    } as BaselineData;
  };

  const targetHour = (new Date().getHours() + forecastHour) % 24;
  let diurnal = HOURLY_TRAFFIC[targetHour] ?? 1.0;
  if (forecastHour === 0) {
    const region = detectRegion(cLat, cLon);
    const today = new Date().toISOString().slice(0, 10);
    const temporalRaw = await redisGet(`vayu:temporal:${region}:${today}`);
    if (temporalRaw) {
      try {
        const temporal = JSON.parse(temporalRaw);
        const aiFactor = temporal.hourly_factors?.[targetHour];
        if (typeof aiFactor === 'number' && aiFactor > 0) diurnal = aiFactor * 0.6 + diurnal * 0.4;
      } catch {
        // Keep static diurnal fallback.
      }
    }
  }

  return roads
    .map((road) => {
      const coords = parseLineCoords(road.geojson);
      if (coords.length < 2) return null;
      const midpoint = roadMidpoint(coords);
      const baseline = interpCorrected(midpoint[1], midpoint[0]);
      const score = computeRoadAQI(road, baseline, diurnal);
      return {
        road,
        midpoint,
        progress: projectProgressOnLine(startLat, startLng, endLat, endLng, midpoint[1], midpoint[0]),
        length_m: lineLengthMeters(coords),
        score,
      } satisfies CorridorRoadScore;
    })
    .filter((road): road is CorridorRoadScore => road !== null);
}

// ─── Exported scoring function (used by clean-route.ts too) ─
export interface RouteScoreV2Result {
  avg_aqi: number;
  max_aqi: number;
  min_aqi: number;
  avg_pm25_delta: number;
  max_pm25_delta: number;
  pollution_index: number;
  combined_score: number;
  vehicle_type: string;
  segment_count: number;
  ai_enhanced: boolean;
  vayu_scored: boolean;
  baseline_pm25: number;
  baseline_no2: number;
  wind_speed: number;
  waqi_station: string | null;
  /**
   * Length-weighted absolute average AQI along the matched segments. This is
   * the field that should be used to compare cleanliness across routes — it
   * includes baseline AQI of the area, not just the marginal traffic delta.
   */
  length_weighted_aqi: number;
  /**
   * Haber-rule cumulative inhalation dose proxy: Σ(pm25_i^1.3 · duration_i_s)
   * at pedestrian speed (1.39 m/s). Use this for "would I rather walk 15min in
   * AQI 50 or 8min in AQI 90?" trade-offs — flat length-weighted AQI under-counts
   * shorter-but-much-dirtier routes.
   */
  haber_dose_pm25: number;
  segments: Array<{
    osm_way_id: number;
    highway: string;
    name: string | null;
    aqi: number;
    pm25: number;
    no2: number;
    fraction_along: number;
    pm25_delta: number;
    length_m: number;
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

  // WAQI bias correction + Sentinel-5P satellite NO₂ (Module A)
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;
  const [bias, satNO2Interp] = await Promise.all([
    fetchWAQIBias(cLat, cLon, baselineCenter),
    fetchSatelliteNO2(south, west, north, east).catch(() => null),
  ]);

  const interpCorrected = (lat: number, lon: number): BaselineData => {
    const raw = interpBaseline(lat, lon);
    let correctedNO2 = Math.max(0, raw.no2 + bias.no2);
    // Apply Sentinel-5P spatial NO₂ correction if available
    if (satNO2Interp) {
      correctedNO2 *= satNO2Interp(lat, lon);
    }
    return {
      ...raw,
      pm25: Math.max(0, raw.pm25 + bias.pm25),
      pm10: Math.max(0, raw.pm10 + bias.pm10),
      no2: correctedNO2,
      o3: Math.max(0, raw.o3 + bias.o3),
    } as BaselineData;
  };

  const targetHour = (new Date().getHours() + forecastHour) % 24;
  let diurnal = HOURLY_TRAFFIC[targetHour] ?? 1.0;
  const weights = VEHICLE_WEIGHTS[vehicleType] || VEHICLE_WEIGHTS.pedestrian;

  // ── Module B: Temporal AI correction — blend Gemini-predicted hourly factors ──
  if (forecastHour === 0) {
    const region = detectRegion(cLat, cLon);
    const today = new Date().toISOString().slice(0, 10);
    const temporalRaw = await redisGet(`vayu:temporal:${region}:${today}`);
    if (temporalRaw) {
      try {
        const tc = JSON.parse(temporalRaw);
        const aiFactor = tc.hourly_factors?.[targetHour];
        if (typeof aiFactor === 'number' && aiFactor > 0) {
          diurnal = aiFactor * 0.6 + diurnal * 0.4;
        }
      } catch { /* use static diurnal */ }
    }
  }

  if (roads.length === 0) {
    // Fallback: Open-Meteo baseline per-point. Previous version returned
    // pollution_index=0 for every route here, making cleanest-vs-fastest
    // comparison meaningless. Now we return a real length-weighted AQI so
    // routes through cleaner regions still win.
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
    // Approximate length between sample points along the polyline.
    const polyLen = lineLengthMeters(polyline.map(([lat, lon]) => [lon, lat]));
    const perSampleLen = polyLen / Math.max(1, results.length);
    return {
      avg_aqi: Math.round(avgAqi),
      max_aqi: Math.max(...aqiValues),
      min_aqi: Math.min(...aqiValues),
      avg_pm25_delta: 0,
      max_pm25_delta: 0,
      pollution_index: avgAqi, // use absolute AQI as proxy when no traffic data
      length_weighted_aqi: Math.round(avgAqi),
      // B6 fallback: approximate Haber dose from sampled pm25 values, evenly distributed
      // along the polyline. Δ = polyLen × 0.72 s/m × mean(pm25^1.3).
      haber_dose_pm25: Math.round(
        results.reduce((sum, r) => sum + Math.pow(Math.max(0, r.pm25), 1.3), 0) *
        (polyLen * 0.72 / Math.max(1, results.length)) * 100
      ) / 100,
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
        pm25_delta: 0,
        length_m: perSampleLen,
      })),
    };
  }

  // Sub-sample if >500 segments to stay within time budget
  let scoredRoads = roads;
  if (roads.length > 500) {
    const step = Math.ceil(roads.length / 200);
    scoredRoads = roads.filter((_, i) => i === 0 || i === roads.length - 1 || i % step === 0);
  }

  // ── Module C: Pre-fetch residual error corrections per highway class ──
  const errorCorrections = new Map<string, number>();
  if (forecastHour === 0) {
    const region = detectRegion(cLat, cLon);
    const hwClasses = [...new Set(scoredRoads.map(r => r.highway))];
    await Promise.all(hwClasses.map(async (hw) => {
      const raw = await redisGet(`vayu:correction:${region}:${hw}:${targetHour}`);
      if (raw) {
        const f = parseFloat(raw);
        if (f > 0 && Math.abs(f - 1.0) > 0.01) errorCorrections.set(hw, f);
      }
    }));
  }

  // Score each road segment with VAYU Gaussian model
  const segments: RouteScoreV2Result['segments'] = [];
  let sumAqi = 0;
  let maxAqi = 0;
  let minAqi = Infinity;
  let sumPm25Delta = 0;
  let maxPm25Delta = 0;
  let aiEnhanced = false;

  let sumLength = 0;
  let sumAqiTimesLength = 0;
  // B6: Haber dose accumulator. Haber's rule: toxicological effect ∝ C^n × t with n>1.
  // For PM2.5 short-term cardiopulmonary endpoints, n ≈ 1.3. Walking speed 1.39 m/s ⇒ 0.72 s/m.
  let haberDosePm25 = 0;
  const PEDESTRIAN_SEC_PER_M = 0.72;
  const HABER_EXPONENT = 1.3;

  for (const road of scoredRoads) {
    // Get road centroid for baseline interpolation + actual segment length
    let roadLat = cLat, roadLon = cLon;
    let segLength = 50; // sensible default if geojson parse fails
    try {
      const coords = JSON.parse(road.geojson).coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      roadLon = mid[0]; roadLat = mid[1];
      segLength = lineLengthMeters(coords);
    } catch { /* use center */ }

    const baseline = interpCorrected(roadLat, roadLon);
    let result = computeRoadAQI(road, baseline, diurnal);

    // Apply Module C residual error correction
    const corrFactor = errorCorrections.get(road.highway);
    if (corrFactor) {
      const corrPm25 = Math.round(result.pm25 * corrFactor * 100) / 100;
      const corrNo2 = Math.round(result.no2 * corrFactor * 100) / 100;
      const corrPm10 = Math.round(result.pm10 * corrFactor * 100) / 100;
      result = { ...result, pm25: corrPm25, no2: corrNo2, pm10: corrPm10, aqi: pm25ToAQI(corrPm25) };
    }

    if (road.ai_pollution_factor != null || road.micro_class != null) aiEnhanced = true;

    sumAqi += result.aqi;
    sumPm25Delta += result.pm25_delta;
    sumLength += segLength;
    sumAqiTimesLength += result.aqi * segLength;
    // B6: Haber-rule dose. Time spent in segment × concentration^n.
    const segDurationS = segLength * PEDESTRIAN_SEC_PER_M;
    haberDosePm25 += Math.pow(Math.max(0, result.pm25), HABER_EXPONENT) * segDurationS;
    if (result.aqi > maxAqi) maxAqi = result.aqi;
    if (result.aqi < minAqi) minAqi = result.aqi;
    if (result.pm25_delta > maxPm25Delta) maxPm25Delta = result.pm25_delta;

    segments.push({
      osm_way_id: road.osm_way_id,
      highway: road.highway,
      name: road.name,
      aqi: result.aqi,
      pm25: result.pm25,
      no2: result.no2,
      fraction_along: road.fraction_along ?? 0,
      pm25_delta: result.pm25_delta,
      length_m: segLength,
    });
  }

  const avgAqi = Math.round(sumAqi / segments.length);
  const lengthWeightedAqi = sumLength > 0
    ? Math.round(sumAqiTimesLength / sumLength)
    : avgAqi;
  const avgPm25Delta = segments.length > 0 ? Math.round((sumPm25Delta / segments.length) * 1000) / 1000 : 0;
  const pollutionIndex = Math.round((avgPm25Delta * 0.75 + maxPm25Delta * 0.25) * 1000) / 1000;
  const aqiScore = avgAqi / 500;
  const timeScore = 0.5;

  return {
    avg_aqi: avgAqi,
    max_aqi: maxAqi,
    min_aqi: minAqi === Infinity ? 0 : minAqi,
    avg_pm25_delta: avgPm25Delta,
    max_pm25_delta: Math.round(maxPm25Delta * 1000) / 1000,
    pollution_index: pollutionIndex,
    length_weighted_aqi: lengthWeightedAqi,
    haber_dose_pm25: Math.round(haberDosePm25 * 100) / 100,
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
  const n = 14;
  let totalDev = 0;
  let maxDev = 0;
  for (let i = 0; i < n; i++) {
    const idx1 = Math.min(Math.floor((i / n) * coords1.length), coords1.length - 1);
    const idx2 = Math.min(Math.floor((i / n) * coords2.length), coords2.length - 1);
    const [lng1, lat1] = coords1[idx1];
    const [lng2, lat2] = coords2[idx2];
    const deviation = haversineMeters(lat1, lng1, lat2, lng2);
    totalDev += deviation;
    maxDev = Math.max(maxDev, deviation);
  }
  const avgDev = totalDev / n;
  return avgDev < thresholdMeters && maxDev < thresholdMeters * 2.6;
}

function routeHasBacktracking(coords: number[][]): boolean {
  if (coords.length < 6) return false;
  // B3: denser sampling (40 windows vs 12) so dead-end alleys with U-turns
  // shorter than ~30m don't slip through. Also flag a single hard reversal
  // (>2.5 rad ≈ 143°) — two reversals was a false-negative bar for the
  // Menteng→Tugu Tani case.
  const step = Math.max(1, Math.floor(coords.length / 40));
  let reversals = 0;
  let hardReversals = 0;
  for (let index = step; index < coords.length - step; index += step) {
    const prev = coords[index - step];
    const curr = coords[index];
    const next = coords[Math.min(index + step, coords.length - 1)];
    const bearingA = Math.atan2(curr[0] - prev[0], curr[1] - prev[1]);
    const bearingB = Math.atan2(next[0] - curr[0], next[1] - curr[1]);
    let diff = Math.abs(bearingA - bearingB);
    while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
    if (diff > 2.5) reversals += 1;
    if (diff > 2.8) hardReversals += 1; // ≥160° = U-turn — single occurrence is enough.
  }
  if (hardReversals >= 1) return true;
  if (reversals >= 2) return true;
  // Geometric backtrack: any point in the second half that's closer to the
  // start than the 25% mark indicates the route looped back substantially.
  const startPt = coords[0];
  const quarterPt = coords[Math.floor(coords.length * 0.25)];
  const distAtQuarter = Math.hypot(quarterPt[0] - startPt[0], quarterPt[1] - startPt[1]);
  for (let i = Math.floor(coords.length * 0.5); i < coords.length; i += step) {
    const d = Math.hypot(coords[i][0] - startPt[0], coords[i][1] - startPt[1]);
    if (d < distAtQuarter * 0.85) return true;
  }
  return false;
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
  orsOptions?: Record<string, unknown>,
  preference?: 'fastest' | 'shortest' | 'recommended',
): Promise<ORSRoute[]> {
  const body: Record<string, unknown> = { coordinates, instructions: true, geometry: true };
  if (altParams) body.alternative_routes = altParams;
  if (orsOptions && Object.keys(orsOptions).length > 0) body.options = orsOptions;
  if (preference) body.preference = preference;

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

// ────────────────────────────────────────────────────────────────────
// 2026-05-24 PIVOT: Valhalla adapter
//
// Replaces ORS public-API calls with self-hosted Valhalla (Docker container
// on Tristan PC, exposed via Tailscale Funnel). Adapter pattern: Valhalla
// /route response → ORSRoute shape so downstream scorePolyline + ranking
// pipeline unchanged.
//
// Feature flag: ROUTING_ENGINE env var. 'valhalla' = new path, anything else
// = ORS (legacy). Default 'ors' until Tristan flips post-staging-test.
// Single env var flip = rollback.
//
// Valhalla server URL: VALHALLA_BASE_URL env var. For local dev:
// http://localhost:8002. For Vercel production: Tailscale Funnel HTTPS URL.
// ────────────────────────────────────────────────────────────────────

const ROUTING_ENGINE = (process.env.ROUTING_ENGINE || 'ors').toLowerCase();
const VALHALLA_BASE_URL = process.env.VALHALLA_BASE_URL || 'http://localhost:8002';

/** Decode Valhalla encoded polyline (precision 6, 1e-6 deg).
 *  Returns array of [lng, lat] (matches ORS geometry shape). */
function decodeValhallaPolyline6(encoded: string): number[][] {
  const points: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) !== 0) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) !== 0) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    // Valhalla polyline6: precision 1e-6, [lng, lat] for ORS-compatible shape
    points.push([lng / 1e6, lat / 1e6]);
  }
  return points;
}

interface ValhallaManeuver {
  instruction?: string;
  length?: number; // km
  time?: number;   // seconds
  type?: number;
  begin_shape_index?: number;
}

interface ValhallaLeg {
  summary?: { length?: number; time?: number };
  shape?: string;
  maneuvers?: ValhallaManeuver[];
}

interface ValhallaTrip {
  summary?: { length?: number; time?: number };
  legs?: ValhallaLeg[];
}

interface ValhallaResponse {
  trip?: ValhallaTrip;
  alternates?: Array<{ trip?: ValhallaTrip }>;
}

/** Convert single Valhalla trip → ORSRoute shape. */
function valhallaTripToORSRoute(trip: ValhallaTrip | undefined): ORSRoute | null {
  if (!trip || !trip.legs || trip.legs.length === 0) return null;
  const summary = trip.summary ?? {};
  const distanceKm = summary.length ?? 0;
  const distanceM = Math.round(distanceKm * 1000);
  const durationS = Math.round(summary.time ?? 0);

  // Concatenate all leg shapes into single geometry
  const geometry: number[][] = [];
  const allManeuvers: ValhallaManeuver[] = [];
  for (const leg of trip.legs) {
    if (leg.shape) {
      const points = decodeValhallaPolyline6(leg.shape);
      if (geometry.length > 0 && points.length > 0) {
        geometry.pop(); // dedupe shared endpoint between legs
      }
      geometry.push(...points);
    }
    if (leg.maneuvers) allManeuvers.push(...leg.maneuvers);
  }

  // Map Valhalla maneuvers → ORS segments[].steps[] shape
  const steps = allManeuvers.map((m) => ({
    instruction: m.instruction ?? '',
    distance: Math.round((m.length ?? 0) * 1000), // km → m
    duration: Math.round(m.time ?? 0),
    type: m.type ?? 0,
    way_points: [m.begin_shape_index ?? 0],
  }));

  return {
    summary: { distance: distanceM, duration: durationS },
    geometry,
    segments: [{ steps }],
  };
}

/** Map legacy ORS profile string → Valhalla costing model. */
function orsProfileToValhallaCosting(orsProfile: string): string {
  switch (orsProfile) {
    case 'foot-walking':
    case 'foot-hiking':
      return 'pedestrian';
    case 'cycling-regular':
    case 'cycling-road':
    case 'cycling-electric':
    case 'cycling-mountain':
      return 'bicycle';
    case 'driving-car':
      return 'auto';
    case 'driving-hgv':
      return 'truck';
    default:
      return 'auto'; // safe default
  }
}

/** Fetch alternatives from self-hosted Valhalla. Returns ORSRoute[] for downstream compat.
 *  Sends X-Breeva-Auth header when VALHALLA_AUTH_TOKEN env is set (required when
 *  VALHALLA_BASE_URL points to public Tailscale Funnel via nginx auth proxy). */
async function fetchValhallaAlternatives(
  start: [number, number], end: [number, number],
  costing: string, targetCount: number,
  costingOptions?: Record<string, unknown>,
): Promise<ORSRoute[]> {
  // Valhalla request: alternates count = N - 1 (primary + N-1 alts)
  const alternatesCount = Math.max(0, targetCount - 1);
  const body: Record<string, unknown> = {
    locations: [
      { lat: start[1], lon: start[0] },  // ORS uses [lng, lat]; Valhalla uses {lat, lon}
      { lat: end[1], lon: end[0] },
    ],
    costing,
    alternates: alternatesCount,
    directions_options: { units: 'kilometers' },
  };
  if (costingOptions && Object.keys(costingOptions).length > 0) {
    body.costing_options = { [costing]: costingOptions };
  }

  // Auth header for nginx sidecar (only when going through Tailscale Funnel).
  // For local dev (VALHALLA_BASE_URL=http://localhost:8002), token is optional.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authToken = process.env.VALHALLA_AUTH_TOKEN;
  if (authToken) headers['X-Breeva-Auth'] = authToken;

  const resp = await fetch(`${VALHALLA_BASE_URL}/route`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Valhalla ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as ValhallaResponse;
  const routes: ORSRoute[] = [];

  const primary = valhallaTripToORSRoute(data.trip);
  if (primary) routes.push(primary);

  for (const alt of (data.alternates ?? [])) {
    const r = valhallaTripToORSRoute(alt.trip);
    if (r) routes.push(r);
  }

  return routes.slice(0, targetCount);
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
    const {
      start, end, profile = 'foot-walking', alternatives = 3,
      // Tier 2 M1: user slider [0..1]; 0 = fastest, 1 = cleanest.
      aqi_weight: aqiWeightRaw,
      // Tier 2 M2: forecast start timestamp (ISO 8601). Defaults to now.
      start_at: startAtRaw,
      // 2026-05-24 Valhalla pivot: client passes native costing + options.
      // Backend uses these when ROUTING_ENGINE=valhalla, otherwise falls back to profile mapping.
      valhalla_costing: valhallaCostingRaw,
      valhalla_options: valhallaOptionsRaw,
    } = body;
    const valhallaCosting = typeof valhallaCostingRaw === 'string' && valhallaCostingRaw
      ? valhallaCostingRaw
      : orsProfileToValhallaCosting(profile);
    const valhallaOptions = (valhallaOptionsRaw && typeof valhallaOptionsRaw === 'object')
      ? (valhallaOptionsRaw as Record<string, unknown>)
      : undefined;
    const userAqiWeight = typeof aqiWeightRaw === 'number'
      ? Math.max(0, Math.min(1, aqiWeightRaw))
      : null;
    const userStartAt = typeof startAtRaw === 'string' ? startAtRaw : undefined;

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
    const directDistanceM = haversineMeters(startLat, startLng, endLat, endLng);
    console.log(`[clean-route] start=${startLat.toFixed(6)},${startLng.toFixed(6)} end=${endLat.toFixed(6)},${endLng.toFixed(6)} direct=${directDistanceM.toFixed(0)}m`);

    const orsApiKey = process.env.VITE_OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY;

    const bufferDeg = 0.003;
    const corridorSouth = Math.min(startLat, endLat) - bufferDeg;
    const corridorNorth = Math.max(startLat, endLat) + bufferDeg;
    const corridorWest = Math.min(startLng, endLng) - bufferDeg;
    const corridorEast = Math.max(startLng, endLng) + bufferDeg;

    const corridorHighways = [
      'motorway', 'motorway_link', 'trunk', 'trunk_link',
      'primary', 'primary_link', 'secondary', 'secondary_link',
      'tertiary', 'tertiary_link', 'residential', 'living_street',
      'service', 'unclassified', 'footway', 'pedestrian', 'path', 'cycleway',
    ];

    // Tier 2 M1: when user supplies aqi_weight, also fetch a Dijkstra v2 candidate.
    // Three weights are pre-warmed (0/0.5/1.0) so the picker always has the slider-
    // matched path; if user passes a specific value we add it as a 4th call.
    const m1Weights = userAqiWeight != null && ![0, 0.5, 1].includes(userAqiWeight)
      ? [0.0, 0.5, 1.0, userAqiWeight]
      : [0.0, 0.5, 1.0];

    // 2026-05-24 Valhalla pivot: ROUTING_ENGINE env flag dispatch
    const useValhalla = ROUTING_ENGINE === 'valhalla';
    const enginePromise = useValhalla
      ? fetchValhallaAlternatives(orsStart, orsEnd, valhallaCosting, alternatives, valhallaOptions).catch((e) => {
          console.error('Valhalla error:', e);
          return [] as ORSRoute[];
        })
      : fetchORSAlternatives(orsStart, orsEnd, profile, alternatives).catch((e) => {
          console.error('ORS error:', e);
          return [] as ORSRoute[];
        });

    const [orsRoutes, throughRoads, graphEdges, corridorRoadRows, ...m1Results] = await Promise.all([
      enginePromise,
      findThroughGangRoads(corridorSouth, corridorWest, corridorNorth, corridorEast).catch(() => [] as ThroughGangRoad[]),
      findGraphOptimalRoute(startLat, startLng, endLat, endLng).catch(() => [] as GraphRouteEdge[]),
      findRoadsInBBox(corridorSouth, corridorWest, corridorNorth, corridorEast, 700, corridorHighways).catch(() => [] as RoadRow[]),
      // Tier 2 M1 candidates (pgRouting multi-criteria Dijkstra). Failure is non-fatal —
      // pre-MV-refresh deployments return empty arrays and route-score falls back to
      // the legacy graphEdges + ORS pipeline.
      ...m1Weights.map((w) =>
        findAqiOptimalRouteV2(startLat, startLng, endLat, endLng, w).catch(() => [] as GraphRouteEdgeV2[])
      ),
    ]);

    if (orsRoutes.length === 0 && graphEdges.length === 0) {
      return res.status(200).json(emptyResponse('no_routes_found'));
    }

    type ScoredCandidate = {
      index: number;
      source: 'ors' | 'avoid-pollution' | 'through-road' | 'graph' | 'perpendicular';
      polyline: Array<{ lat: number; lng: number }>;
      distance_meters: number;
      duration_seconds: number;
      instructions: Array<{ text: string; distance: number; duration: number; type: number; waypoint_index: number }>;
      score: RouteScoreV2Result | null;
    };

    const orsToScoredEntry = async (ors: ORSRoute, index: number, source: ScoredCandidate['source']): Promise<ScoredCandidate> => {
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
      return {
        index,
        source,
        polyline: waypoints,
        distance_meters: Math.round(ors.summary.distance),
        duration_seconds: Math.round(ors.summary.duration),
        instructions,
        score,
      };
    };

    const dedupedOrs: ORSRoute[] = [];
    for (const ors of orsRoutes) {
      if (!routeHasBacktracking(ors.geometry) && !dedupedOrs.some(existing => isSimilarGeometry(existing.geometry, ors.geometry, 55))) {
        dedupedOrs.push(ors);
      }
    }

    const scoredRoutes: ScoredCandidate[] = await Promise.all(
      dedupedOrs.map((ors, index) => orsToScoredEntry(ors, index, 'ors'))
    );

    const directCandidate = scoredRoutes[0] ?? null;
    let skipAvoidPolygons = false;
    if (directCandidate?.score?.avg_aqi && directCandidate.score.avg_aqi <= 50) {
      skipAvoidPolygons = true;
      console.log('[clean-route] Direct route is already clean (AQI <= 50). Skipping avoid_polygons.');
    }

    const corridorScores = await scoreCorridorRoads(
      corridorRoadRows,
      startLat,
      startLng,
      endLat,
      endLng,
      corridorSouth,
      corridorWest,
      corridorNorth,
      corridorEast,
      0,
    ).catch(() => [] as CorridorRoadScore[]);

    if (!skipAvoidPolygons && corridorScores.length > 0) {
      const corridorAqiValues = corridorScores.map((road) => road.score.aqi);
      const minCorridorAqi = Math.min(...corridorAqiValues);
      const maxCorridorAqi = Math.max(...corridorAqiValues);
      const spread = maxCorridorAqi - minCorridorAqi;
      if (spread < 30) {
        skipAvoidPolygons = true;
        console.log(`[clean-route] Corridor AQI spread too low (${spread.toFixed(1)}). Skipping avoid_polygons.`);
      }
    }

    const corridorByWayId = new Map(corridorScores.map((road) => [road.road.osm_way_id, road]));

    const addCandidate = async (candidateRoute: ORSRoute, source: ScoredCandidate['source']) => {
      if (routeHasBacktracking(candidateRoute.geometry)) return;
      if (scoredRoutes.some((existing) => isSimilarGeometry(existing.polyline.map((point) => [point.lng, point.lat]), candidateRoute.geometry, 60))) {
        return;
      }
      const entry = await orsToScoredEntry(candidateRoute, scoredRoutes.length, source);
      const shortestDuration = Math.min(...scoredRoutes.map((route) => route.duration_seconds), entry.duration_seconds);
      if (entry.duration_seconds > shortestDuration * 1.45) return;
      // B4: reject candidates that funnel the user through a hellscape segment.
      // 200 AQI = Very Unhealthy threshold — no walking route should ever push through that.
      if (entry.score?.max_aqi !== undefined && entry.score.max_aqi > 200) {
        console.log(`[clean-route] reject ${source}: max segment AQI ${entry.score.max_aqi} > 200`);
        return;
      }
      // B10: variance gate — if this candidate's length-weighted AQI is within 5 of any existing
      // candidate, it doesn't add diversity. Skip unless it's strictly better on duration.
      // 'ors' candidates bypass this since they're the foundational set.
      if (source !== 'ors' && entry.score?.length_weighted_aqi !== undefined) {
        const newAqi = entry.score.length_weighted_aqi;
        const duplicateAqi = scoredRoutes.some((existing) => {
          const existingAqi = existing.score?.length_weighted_aqi;
          if (existingAqi === undefined) return false;
          if (Math.abs(existingAqi - newAqi) >= 5) return false;
          return entry.duration_seconds >= existing.duration_seconds * 0.95;
        });
        if (duplicateAqi) {
          console.log(`[clean-route] reject ${source}: AQI ${newAqi} duplicates existing within ±5`);
          return;
        }
      }
      scoredRoutes.push(entry);
    };

    if (orsApiKey && corridorScores.length > 0 && !skipAvoidPolygons) {
      const avoidPolygons = buildAvoidPolygons(corridorScores, orsStart as [number, number], orsEnd as [number, number]);
      if (avoidPolygons) {
        try {
          const avoided = await doORSRequest([orsStart, orsEnd], profile, orsApiKey, undefined, { avoid_polygons: avoidPolygons }, 'recommended');
          if (avoided[0]) await addCandidate(avoided[0], 'avoid-pollution');
        } catch (error) {
          console.error('[clean-route] avoid_polygons candidate failed:', error);
        }
      }
    }

    if (orsApiKey && throughRoads.length > 0 && corridorScores.length > 0) {
      try {
        const deltaValues = corridorScores.map((road) => road.score.pm25_delta);
        const minDelta = Math.min(...deltaValues);
        const maxDelta = Math.max(...deltaValues);
        const travelBearing = Math.atan2(endLng - startLng, endLat - startLat);

        const rankedThroughRoads = throughRoads
          .map((throughRoad) => {
            const corridorRoad = corridorByWayId.get(throughRoad.osm_way_id);
            const coords = parseLineCoords(throughRoad.geojson);
            if (!corridorRoad || coords.length < 2) return null;
            const first = coords[0];
            const last = coords[coords.length - 1];
            const roadBearing = Math.atan2(last[0] - first[0], last[1] - first[1]);
            const angleDiff = Math.abs(travelBearing - roadBearing);
            const alignment = Math.abs(Math.cos(angleDiff));
            const connections = Math.min((throughRoad.start_connections + throughRoad.end_connections) / 6, 1);
            const normalizedDelta = maxDelta > minDelta
              ? (corridorRoad.score.pm25_delta - minDelta) / (maxDelta - minDelta)
              : 0;
            const cleanScore = 1 - normalizedDelta;
            const centrality = 1 - Math.abs(corridorRoad.progress - 0.5) * 2;
            const lengthScore = Math.min((throughRoad.road_length_m || corridorRoad.length_m) / 120, 1);
            const routeScore = cleanScore * 0.45 + alignment * 0.2 + connections * 0.2 + centrality * 0.1 + lengthScore * 0.05;
            return { throughRoad, corridorRoad, routeScore };
          })
          .filter((road): road is NonNullable<typeof road> => road !== null)
          .sort((a, b) => b.routeScore - a.routeScore);

        const chosenThroughRoads: typeof rankedThroughRoads = [];
        for (const candidate of rankedThroughRoads) {
          if (chosenThroughRoads.some((existing) => Math.abs(existing.corridorRoad.progress - candidate.corridorRoad.progress) < 0.18)) {
            continue;
          }
          chosenThroughRoads.push(candidate);
          if (chosenThroughRoads.length >= 2) break;
        }

        // B2+B8: for each chosen through-road, compute its entry/exit waypoints
        // (closer-to-start = entry, closer-to-end = exit) so ORS traverses the
        // alley fully. Then either emit per-road requests OR chain them into a
        // single multi-waypoint request when their progress is monotonic.
        type ChainSegment = {
          entry: [number, number]; exit: [number, number]; progress: number;
        };
        const segs: ChainSegment[] = chosenThroughRoads.map((candidate) => {
          const a: [number, number] = [candidate.throughRoad.start_lng, candidate.throughRoad.start_lat];
          const b: [number, number] = [candidate.throughRoad.end_lng, candidate.throughRoad.end_lat];
          const distAEnd = haversineMeters(a[1], a[0], orsEnd[1], orsEnd[0]);
          const distBEnd = haversineMeters(b[1], b[0], orsEnd[1], orsEnd[0]);
          const exit = distAEnd < distBEnd ? a : b;
          const entry = distAEnd < distBEnd ? b : a;
          const entryDistFromStart = haversineMeters(entry[1], entry[0], orsStart[1], orsStart[0]);
          const exitDistFromStart = haversineMeters(exit[1], exit[0], orsStart[1], orsStart[0]);
          const orderedEntry = entryDistFromStart < exitDistFromStart ? entry : exit;
          const orderedExit = entryDistFromStart < exitDistFromStart ? exit : entry;
          return { entry: orderedEntry, exit: orderedExit, progress: candidate.corridorRoad.progress };
        });

        // Per-road requests (always emitted — preserves single-alley diversity).
        for (const seg of segs) {
          try {
            const routeResult = await doORSRequest([orsStart, seg.entry, seg.exit, orsEnd], profile, orsApiKey, undefined, undefined, 'recommended');
            if (routeResult[0]) await addCandidate(routeResult[0], 'through-road');
          } catch (error) {
            console.error('[clean-route] through-road candidate failed:', error);
          }
        }

        // B8: chain multiple alleys when they sit along the same corridor (monotonic
        // progress with separation ≥ 0.2). Single ORS request stitches them together.
        if (segs.length >= 2) {
          const ordered = [...segs].sort((a, b) => a.progress - b.progress);
          const wellSeparated = ordered.every((s, i) => i === 0 || (s.progress - ordered[i - 1].progress) >= 0.2);
          if (wellSeparated) {
            const chained: [number, number][] = [orsStart];
            for (const s of ordered) { chained.push(s.entry); chained.push(s.exit); }
            chained.push(orsEnd);
            try {
              const routeResult = await doORSRequest(chained, profile, orsApiKey, undefined, undefined, 'recommended');
              if (routeResult[0]) await addCandidate(routeResult[0], 'through-road');
            } catch (error) {
              console.error('[clean-route] multi-alley chain failed:', error);
            }
          }
        }
      } catch (error) {
        console.error('[clean-route] AQI-aware through-road routing failed:', error);
      }
    }

    if (graphEdges.length > 0) {
      try {
        const graphWaypoints: Array<{ lat: number; lng: number }> = [];
        let totalDistanceM = 0;
        // B5: stitch-gap validation. If any edge join exceeds this, the graph is broken
        // (mis-noded segments, orphan edges) and the resulting polyline will teleport.
        const MAX_STITCH_GAP_M = 30;
        let stitchBroken = false;
        let worstGap = 0;

        for (const edge of graphEdges) {
          const coords: number[][] = JSON.parse(edge.geojson).coordinates;
          if (coords.length < 2) continue;
          totalDistanceM += edge.length_m;

          if (graphWaypoints.length === 0) {
            // First edge — add all points
            for (const c of coords) graphWaypoints.push({ lat: c[1], lng: c[0] });
          } else {
            // Subsequent edges — check orientation and connect
            const prevEnd = graphWaypoints[graphWaypoints.length - 1];
            const edgeStart = coords[0];
            const edgeEnd = coords[coords.length - 1];
            const distToStart = haversineMeters(prevEnd.lat, prevEnd.lng, edgeStart[1], edgeStart[0]);
            const distToEnd = haversineMeters(prevEnd.lat, prevEnd.lng, edgeEnd[1], edgeEnd[0]);
            const gap = Math.min(distToStart, distToEnd);
            if (gap > worstGap) worstGap = gap;
            if (gap > MAX_STITCH_GAP_M) {
              stitchBroken = true;
              break;
            }

            const orderedCoords = distToEnd < distToStart ? [...coords].reverse() : coords;
            // Skip first point (shared with previous edge's endpoint)
            for (let i = 1; i < orderedCoords.length; i++) {
              graphWaypoints.push({ lat: orderedCoords[i][1], lng: orderedCoords[i][0] });
            }
          }
        }

        if (stitchBroken) {
          console.warn(`[clean-route] Phase 3 graph route rejected: stitch gap ${worstGap.toFixed(1)}m > ${MAX_STITCH_GAP_M}m. Topology likely broken in road_graph_edges — run vayu/jobs/repair_road_graph.py.`);
        }

        if (!stitchBroken && graphWaypoints.length >= 2 && totalDistanceM > 0) {
          const durationSeconds = Math.round(totalDistanceM * 0.72);
          const polyline: [number, number][] = graphWaypoints.map(w => [w.lat, w.lng]);

          let score;
          try {
            score = await scorePolyline(polyline, 'pedestrian', 0);
          } catch { score = null; }

          const instructions = graphEdges.map((e, i) => ({
            text: `Walk along ${e.name || e.highway}`,
            distance: e.length_m,
            duration: e.length_m * 0.72,
            type: 0,
            waypoint_index: i,
          }));

          const graphEntry = {
            index: scoredRoutes.length,
            source: 'graph' as const,
            polyline: graphWaypoints,
            distance_meters: Math.round(totalDistanceM),
            duration_seconds: durationSeconds,
            instructions,
            score,
          };

          const shortestDuration = Math.min(...scoredRoutes.map(r => r.duration_seconds));
          const isDuplicate = scoredRoutes.some(r =>
            isSimilarGeometry(
              graphWaypoints.map(w => [w.lng, w.lat]),
              r.polyline.map(p => [p.lng, p.lat]),
              60
            )
          );

          if (!isDuplicate && graphEntry.duration_seconds <= shortestDuration * 1.5 && !routeHasBacktracking(graphWaypoints.map(w => [w.lng, w.lat]))) {
            const graphAqi = graphEntry.score?.pollution_index ?? 999;
            if (scoredRoutes.length < 6) {
              scoredRoutes.push(graphEntry);
            } else {
              const worstIdx = scoredRoutes.reduce((wi, r, i) =>
                (r.score?.pollution_index ?? 0) > (scoredRoutes[wi].score?.pollution_index ?? 0) ? i : wi, 0);
              const worstAqi = scoredRoutes[worstIdx].score?.pollution_index ?? 0;
              if (graphAqi < worstAqi) {
                scoredRoutes[worstIdx] = { ...graphEntry, index: scoredRoutes[worstIdx].index };
              }
            }
          }
        }
      } catch (e) {
        console.error('[clean-route] Phase 3 graph routing failed:', e);
      }
    }

    // ─── Phase A4 (Tier 2 M1): Multi-Criteria Dijkstra slider candidates ──
    // Each of m1Results[i] is the path for m1Weights[i]. Stitch + score + add.
    // Failure-tolerant: empty arrays simply skip the corresponding weight.
    for (let mi = 0; mi < m1Results.length; mi++) {
      const path = m1Results[mi] as GraphRouteEdgeV2[];
      const alpha = m1Weights[mi];
      if (!path || path.length === 0) continue;

      try {
        const waypts: Array<{ lat: number; lng: number }> = [];
        let totalLen = 0;
        let totalDose = 0;
        let stitchBroken = false;
        let worstGap = 0;
        const MAX_STITCH_GAP_M = 30;

        for (const edge of path) {
          const geom = JSON.parse(edge.geojson);
          const coords: number[][] = geom.coordinates || [];
          if (coords.length < 2) continue;
          totalLen += edge.length_m;
          totalDose += edge.haber_dose;

          if (waypts.length === 0) {
            for (const c of coords) waypts.push({ lat: c[1], lng: c[0] });
          } else {
            const prevEnd = waypts[waypts.length - 1];
            const eS = coords[0]; const eE = coords[coords.length - 1];
            const dS = haversineMeters(prevEnd.lat, prevEnd.lng, eS[1], eS[0]);
            const dE = haversineMeters(prevEnd.lat, prevEnd.lng, eE[1], eE[0]);
            const gap = Math.min(dS, dE);
            if (gap > worstGap) worstGap = gap;
            if (gap > MAX_STITCH_GAP_M) { stitchBroken = true; break; }
            const ordered = dE < dS ? [...coords].reverse() : coords;
            for (let i = 1; i < ordered.length; i++) {
              waypts.push({ lat: ordered[i][1], lng: ordered[i][0] });
            }
          }
        }

        if (stitchBroken) {
          console.warn(`[clean-route] M1 α=${alpha} rejected: stitch gap ${worstGap.toFixed(1)}m > ${MAX_STITCH_GAP_M}m`);
          continue;
        }
        if (waypts.length < 2 || totalLen <= 0) continue;
        if (routeHasBacktracking(waypts.map(w => [w.lng, w.lat]))) {
          console.warn(`[clean-route] M1 α=${alpha} rejected: backtracking detected`);
          continue;
        }

        const polyline: [number, number][] = waypts.map(w => [w.lat, w.lng]);
        let score: RouteScoreV2Result | null = null;
        try { score = await scorePolyline(polyline, 'pedestrian', 0); } catch { score = null; }

        const durationSeconds = Math.round(totalLen * 0.72);
        const isDuplicate = scoredRoutes.some((r) =>
          isSimilarGeometry(
            waypts.map(w => [w.lng, w.lat]),
            r.polyline.map(p => [p.lng, p.lat]),
            60
          )
        );
        if (isDuplicate) continue;

        scoredRoutes.push({
          index: scoredRoutes.length,
          source: 'graph',
          polyline: waypts,
          distance_meters: Math.round(totalLen),
          duration_seconds: durationSeconds,
          instructions: [],
          score,
        });
        console.log(`[clean-route] M1 α=${alpha} added: ${Math.round(totalLen)}m, dose=${totalDose.toFixed(1)}, segments=${path.length}`);
      } catch (e) {
        console.error(`[clean-route] M1 α=${alpha} stitch failed:`, e);
      }
    }

    if (orsApiKey && scoredRoutes.length < 3) {
      // B9: try 'shortest' first on alternating sides — shortest preference forces
      // ORS to actually deviate (vs 'recommended' which often hugs the same arterial),
      // giving real geometric diversity for the AQI gate to choose from.
      const offsets = [200, -200, 350, -350, 550, -550];
      for (const offset of offsets) {
        if (scoredRoutes.length >= 3) break;
        try {
          const wp = getPerpendicularPoint(orsStart, orsEnd, offset);
          const routeResult = await doORSRequest([orsStart, wp, orsEnd], profile, orsApiKey, undefined, undefined, 'shortest');
          if (routeResult[0]) await addCandidate(routeResult[0], 'perpendicular');
        } catch {
          // Ignore perpendicular fallback failures.
        }
      }
    }

    const uniqueCandidates: ScoredCandidate[] = [];
    for (const route of scoredRoutes) {
      const routeCoords = route.polyline.map((point) => [point.lng, point.lat] as [number, number]);
      if (!uniqueCandidates.some((existing) => isSimilarGeometry(routeCoords, existing.polyline.map((point) => [point.lng, point.lat]), 60))) {
        uniqueCandidates.push(route);
      }
    }

    const MAX_DETOUR_RATIO = 2.0;
    let filteredCandidates = uniqueCandidates.filter((route) => route.distance_meters <= directDistanceM * MAX_DETOUR_RATIO);
    if (filteredCandidates.length === 0 && uniqueCandidates.length > 0) {
      console.log(`[clean-route] All candidates exceed ${MAX_DETOUR_RATIO}x direct distance (${directDistanceM.toFixed(0)}m). Falling back to shortest candidate.`);
      const shortest = [...uniqueCandidates].sort((a, b) => a.distance_meters - b.distance_meters)[0];
      filteredCandidates = [shortest];
    }

    if (filteredCandidates.length === 0) {
      return res.status(200).json(emptyResponse('no_distinct_routes_found'));
    }

    // B6: cleanest comparison uses Haber-corrected dose when available — captures
    // the C^1.3 × t toxicology of PM2.5 so a longer-but-cleaner route correctly
    // beats a shorter-but-dirtier one. Falls back to length-weighted AQI, then
    // avg AQI, then traffic-only pollution_index.
    const cleanCost = (route: ScoredCandidate) =>
      route.score?.haber_dose_pm25
        ?? route.score?.length_weighted_aqi
        ?? route.score?.avg_aqi
        ?? route.score?.pollution_index
        ?? 999;
    const shortestDuration = Math.min(...filteredCandidates.map((route) => route.duration_seconds));
    const cleanValues = filteredCandidates.map(cleanCost);
    const minClean = Math.min(...cleanValues);
    const maxClean = Math.max(...cleanValues);
    const normalizeClean = (route: ScoredCandidate) => maxClean > minClean ? (cleanCost(route) - minClean) / (maxClean - minClean) : 0;
    const normalizeDuration = (route: ScoredCandidate) => Math.max(0, (route.duration_seconds - shortestDuration) / Math.max(shortestDuration, 1));

    const byDuration = [...filteredCandidates].sort((a, b) => a.duration_seconds - b.duration_seconds);
    const byClean = [...filteredCandidates].sort((a, b) => cleanCost(a) - cleanCost(b));
    const fastestRoute = byDuration[0];
    // Cleanest = lowest length-weighted AQI, full stop. If the cleanest IS
    // also the fastest, that's fine — duplicate labels are deduped by geometry
    // similarity later, and the UI can collapse identical entries.
    const cleanestRoute = byClean[0];
    const usedIndices = new Set([fastestRoute.index, cleanestRoute.index]);
    const balancedRoute = [...filteredCandidates]
      .filter((route) => !usedIndices.has(route.index))
      .sort((a, b) => ((normalizeDuration(a) * 0.55) + (normalizeClean(a) * 0.45)) - ((normalizeDuration(b) * 0.55) + (normalizeClean(b) * 0.45)))[0]
      || byDuration[1]
      || filteredCandidates[0];

    const selectedRoutes = [cleanestRoute, balancedRoute, fastestRoute].filter((route, index, self) => self.findIndex((candidate) => candidate.index === route.index) === index);

    const geminiInput = selectedRoutes.map((r) => {
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

    let reasoning: string | null = null;
    let geminiRanking: GeminiRanking | null = null;
    try {
      geminiRanking = await rankWithGemini(geminiInput);
      reasoning = geminiRanking?.reasoning ?? null;
    } catch { /* skip */ }

    // Wire up Gemini's ranking. If Gemini returned a usable ranking +
    // labels[], reassign labels based on Gemini's judgement. Otherwise fall
    // back to the metric-based labels above. Gemini's `ranking` is the
    // 1-indexed route order (best-to-worst); `labels[i]` corresponds to
    // ranking[i] (i.e., labels[0] is for the best-ranked route).
    let allLabeled: Array<ScoredCandidate & { label: 'cleanest' | 'balanced' | 'fastest'; reasoning: string | null }>;
    const validLabels: Array<'cleanest' | 'balanced' | 'fastest'> = ['cleanest', 'balanced', 'fastest'];
    if (
      geminiRanking
      && Array.isArray(geminiRanking.ranking)
      && Array.isArray(geminiRanking.labels)
      && geminiRanking.ranking.length === selectedRoutes.length
      && geminiRanking.labels.length === selectedRoutes.length
      && geminiRanking.labels.every((l) => validLabels.includes(l as typeof validLabels[number]))
    ) {
      // Map Gemini's 1-indexed route numbers back to candidates via .index.
      // Use index === gemini's (route_number - 1) when possible.
      const reordered: typeof allLabeled = [];
      const seen = new Set<number>();
      for (let i = 0; i < geminiRanking.ranking.length; i++) {
        const routeNum = geminiRanking.ranking[i];
        const candidate = selectedRoutes.find((c) => c.index === routeNum - 1)
          ?? selectedRoutes[Math.min(i, selectedRoutes.length - 1)];
        if (!candidate || seen.has(candidate.index)) continue;
        seen.add(candidate.index);
        reordered.push({
          ...candidate,
          label: geminiRanking.labels[i] as 'cleanest' | 'balanced' | 'fastest',
          reasoning,
        });
      }
      // Make sure all 3 labels are represented; fill from metric-based fallback.
      const labelsPresent = new Set(reordered.map((r) => r.label));
      const metricFallback: Array<[ScoredCandidate, 'cleanest' | 'balanced' | 'fastest']> = [
        [cleanestRoute, 'cleanest'],
        [balancedRoute, 'balanced'],
        [fastestRoute, 'fastest'],
      ];
      for (const [cand, lbl] of metricFallback) {
        if (!labelsPresent.has(lbl) && !seen.has(cand.index)) {
          reordered.push({ ...cand, label: lbl, reasoning });
          labelsPresent.add(lbl);
          seen.add(cand.index);
        }
      }
      allLabeled = reordered;
    } else {
      allLabeled = [
        { ...cleanestRoute, label: 'cleanest' as const, reasoning },
        { ...balancedRoute, label: 'balanced' as const, reasoning },
        { ...fastestRoute, label: 'fastest' as const, reasoning },
      ];
    }

    const labeled: typeof allLabeled = [];
    for (const r of allLabeled) {
      const rCoords = r.polyline.map((p) => [p.lng, p.lat]);
      const isDup = labeled.some((existing) =>
        isSimilarGeometry(rCoords, existing.polyline.map((p) => [p.lng, p.lat]), 60)
      );
      if (!isDup) labeled.push(r);
    }

    // Tier 2 M2: per-route forecast at predicted arrival times. Done in parallel
    // for each labeled candidate. Failure is non-fatal (returns empty forecast).
    const forecastInputs = labeled.map((r) =>
      r.polyline.map((p) => [p.lng, p.lat] as [number, number])
    );
    const forecasts = await Promise.all(
      forecastInputs.map((poly) =>
        forecastRouteExposure(poly, userStartAt).catch(() => [] as RouteForecastSegment[])
      )
    );

    const routes = labeled.map((r, idx) => {
      const forecast = forecasts[idx];
      let forecastSummary: {
        max_aqi: number; max_at_offset_s: number; delta_pct: number;
      } | null = null;
      if (forecast.length > 0 && r.score?.avg_aqi) {
        const maxSeg = forecast.reduce((max, s) => s.segment_aqi > max.segment_aqi ? s : max, forecast[0]);
        const deltaPct = ((maxSeg.segment_aqi - r.score.avg_aqi) / Math.max(1, r.score.avg_aqi)) * 100;
        forecastSummary = {
          max_aqi: maxSeg.segment_aqi,
          max_at_offset_s: maxSeg.arrival_offset_s,
          delta_pct: Math.round(deltaPct * 10) / 10,
        };
      }

      return {
        polyline: r.polyline, distance_meters: r.distance_meters, duration_seconds: r.duration_seconds, instructions: r.instructions,
        vayu_avg_aqi: r.score?.avg_aqi ?? 50, vayu_max_aqi: r.score?.max_aqi ?? 50,
        vayu_min_aqi: r.score?.min_aqi ?? 50,
        vayu_segment_count: r.score?.segment_count ?? 0, vayu_scored: r.score?.vayu_scored ?? false,
        vayu_pollution_index: r.score?.pollution_index ?? 0,
        vayu_haber_dose: r.score?.haber_dose_pm25 ?? 0,
        route_label: r.label, gemini_reasoning: r.reasoning,
        forecast_summary: forecastSummary,
        segments: (r.score?.segments || []).map((s) => ({
          osm_way_id: s.osm_way_id, highway: s.highway, name: s.name,
          aqi: s.aqi, pm25: s.pm25, no2: s.no2, fraction_along: s.fraction_along, pm25_delta: s.pm25_delta,
        })),
        traffic_level: estimateTrafficLevel(r.score?.avg_aqi ?? 50),
        green_score: estimateGreenScore(r.score?.segments || []),
      };
    });

    routes.forEach((candidate, index) => {
      const ratio = directDistanceM > 0 ? candidate.distance_meters / directDistanceM : 1;
      console.log(`[clean-route] candidate[${index}] label=${candidate.route_label} dist=${candidate.distance_meters}m ratio=${ratio.toFixed(2)}x aqi=${candidate.vayu_avg_aqi}`);
    });

    // Tier 2 M3: dark-launch evaluation. Sample ~10% of requests, compute the
    // PPO candidate, score it, and log to shadow_routing_evals — but DO NOT show
    // it to the user yet. Promotion decision happens off-line after ≥1000 evals.
    if (process.env.GNN_PPO_ENABLED === '1' && Math.random() < 0.10) {
      try {
        const ppo = await callPpoSidecar(startLat, startLng, endLat, endLng);
        if (ppo) {
          const ppoPolyline: [number, number][] = ppo.polyline.map(p => [p[1], p[0]]);
          const ppoScore = await scorePolyline(ppoPolyline, 'pedestrian', 0).catch(() => null);
          const cleanestM1 = routes.find(r => r.route_label === 'cleanest') ?? routes[0];
          if (cleanestM1 && ppoScore) {
            await logShadowEval({
              start_lat: startLat, start_lng: startLng, end_lat: endLat, end_lng: endLng,
              region: null,
              user_aqi_weight: userAqiWeight,
              haversine_m: directDistanceM,
              m1: {
                distance_m: cleanestM1.distance_meters,
                duration_s: cleanestM1.duration_seconds,
                avg_aqi: cleanestM1.vayu_avg_aqi,
                length_weighted_aqi: (cleanestM1 as { score?: RouteScoreV2Result }).score?.length_weighted_aqi ?? cleanestM1.vayu_avg_aqi,
                haber_dose: cleanestM1.vayu_haber_dose,
                polyline: cleanestM1.polyline.map(p => [p.lng, p.lat]),
              },
              m3: {
                distance_m: Math.round(ppoPolyline.length * 5), // approx — full edge-stitch needed for true distance
                duration_s: Math.round(ppoPolyline.length * 5 * 0.72),
                avg_aqi: ppoScore.avg_aqi,
                length_weighted_aqi: ppoScore.length_weighted_aqi,
                haber_dose: ppoScore.haber_dose_pm25,
                polyline: ppo.polyline,
              },
              shown_to_user: 'm1',
              model_version_m3: process.env.GNN_PPO_VERSION ?? 'ppo_v1',
            });
          }
        }
      } catch (e) {
        console.warn('[clean-route] M3 shadow eval failed:', e);
      }
    }

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
