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

  // ── AI micro-classification override (from Gemini batch) ──
  // If AI has classified this road, use its class for traffic estimation
  if (road.micro_class) {
    const aiTraffic: Record<string, number> = {
      highway: 4000, arterial: 1500, collector: 600, local_road: 150,
      neighborhood_road: 50, alley: 10, gang: 2, pedestrian_only: 0,
    };
    const base = aiTraffic[road.micro_class];
    if (base != null) return base * diurnal;
  }

  // ── Smart gang/lorong detection (width + name heuristic) ──
  if (road.highway === 'residential' || road.highway === 'living_street') {
    const w = road.width;
    // Width-based micro-classification
    if (w != null && w < 3)  return 2 * diurnal;   // Gang sempit: motor only
    if (w != null && w < 5)  return 15 * diurnal;  // Lorong/gang agak lebar
    if (w != null && w < 6)  return 40 * diurnal;  // Jalan kampung

    // Name-based detection (Indonesian road naming conventions)
    if (road.name) {
      const lower = road.name.toLowerCase();
      if (lower.includes('gang') || lower.includes('gg.') || lower.includes('lorong') ||
          lower.includes('jalan setapak') || lower.includes('lr.') || lower.includes('jl. setapak')) {
        return 5 * diurnal;  // Named gang: near-zero traffic
      }
    }
  }

  // Service roads: differentiate by context
  if (road.highway === 'service') {
    if (road.landuse_proxy === 'residential') return 5 * diurnal;
    if (road.landuse_proxy === 'industrial') return 30 * diurnal;
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

// ─── Region detection for temporal AI correction ────────────
function detectRegion(lat: number, lon: number): string {
  if (lat >= -8.85 && lat <= -8.06 && lon >= 114.43 && lon <= 115.71) return 'bali';
  if (lat >= -6.50 && lat <= -6.08 && lon >= 106.60 && lon <= 107.10) return 'jakarta';
  if (lat >= -7.02 && lat <= -6.82 && lon >= 107.45 && lon <= 107.77) return 'bandung';
  if (lat >= -7.40 && lat <= -7.15 && lon >= 112.55 && lon <= 112.85) return 'surabaya';
  if (lat >= -7.10 && lat <= -6.90 && lon >= 110.30 && lon <= 110.50) return 'semarang';
  if (lat >= -7.87 && lat <= -7.72 && lon >= 110.30 && lon <= 110.50) return 'yogyakarta';
  return 'default';
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
// Phase 6: Increased limits for Canvas renderer (handles 2000+ polylines)
function getQueryParams(zoom: number): { limit: number; highways: string[] | null } {
  if (zoom >= 16) return { limit: 2000, highways: null };         // all roads, max density
  if (zoom >= 15) return { limit: 1200, highways: null };         // all roads
  if (zoom >= 14) return { limit: 800, highways: null };          // all roads
  if (zoom >= 13) return { limit: 600, highways: null };          // all roads
  if (zoom >= 12) return { limit: 350, highways: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'] };
  if (zoom >= 11) return { limit: 200, highways: ['motorway', 'motorway_link', 'trunk', 'trunk_link'] };
  return { limit: 100, highways: ['motorway', 'trunk'] };
}

// ─── Surface type → PM₁₀ coarse fraction multiplier ────────
// Unpaved roads generate 5-10× more resuspended dust (tire/brake/road)
const SURFACE_PM10_FACTOR: Record<string, number> = {
  asphalt: 1.0, paved: 1.0, concrete: 0.9,
  compacted: 1.8, gravel: 3.0, fine_gravel: 2.5,
  dirt: 4.0, ground: 3.5, sand: 4.5, earth: 4.0,
  unpaved: 3.5, mud: 1.5, // mud = wet → less dust
};

// ─── Elevation → atmospheric pressure correction ────────────
// Higher elevation = lower pressure = faster dispersion (less concentration)
// Bandung ~700m → ~0.92 factor, Jakarta ~10m → ~1.0
function elevationFactor(elevationM: number | null): number {
  if (elevationM == null || elevationM <= 0) return 1.0;
  // Barometric formula simplified: P/P0 ≈ exp(-elevation/8500)
  // Dispersion scales roughly inversely with air density
  return Math.max(0.80, Math.exp(-elevationM / 8500));
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
  // Phase 2: additional fields for enhanced accuracy
  name: string | null;
  surface: string | null;
  elevation_avg: number | null;
  // AI classification (from Gemini batch)
  micro_class: string | null;
  ai_pollution_factor: number | null;
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

// ─── Sentinel-5P satellite NO₂ correction ───────────────────
// Fetches satellite-derived NO₂ spatial field and returns an
// interpolation function for per-road correction.
// Cached in Redis for 12h (satellite revisit is daily).
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

  // Check Redis cache (quantized to 0.5° grid)
  const q = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
  const cacheKey = `vayu:sat:no2:${q(south)}:${q(west)}:${q(north)}:${q(east)}`;

  let gridData: SatelliteNO2Grid | null = null;

  const cached = await redisGet(cacheKey);
  if (cached) {
    try { gridData = JSON.parse(cached); } catch { /* fall through */ }
  }

  if (!gridData) {
    try {
      // Authenticate with Copernicus Data Space
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

      // Last 5 days of S5P data (cloud gaps may require wider window)
      const to = new Date();
      const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);

      const processBody = {
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
          width: 8,
          height: 8,
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
      };

      const processResp = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify(processBody),
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
      // Satellite data is non-critical; fail silently
      return null;
    }
  }

  if (!gridData || gridData.grid.every((v) => v <= 0)) return null;

  // Return interpolation function: bilinear on the satellite grid
  // Converts column density (µmol/m²) to surface correction factor
  const { grid, rows, cols, bounds } = gridData;

  // Compute grid mean for normalization (excluding no-data)
  const valid = grid.filter((v) => v > 0);
  if (valid.length === 0) return null;
  const gridMean = valid.reduce((a, b) => a + b, 0) / valid.length;

  return (lat: number, lon: number): number => {
    const latSpan = bounds.north - bounds.south || 0.01;
    const lonSpan = bounds.east - bounds.west || 0.01;
    const fy = Math.max(0, Math.min(rows - 1, ((lat - bounds.south) / latSpan) * (rows - 1)));
    const fx = Math.max(0, Math.min(cols - 1, ((lon - bounds.west) / lonSpan) * (cols - 1)));

    const y0 = Math.floor(fy);
    const x0 = Math.floor(fx);
    const y1 = Math.min(rows - 1, y0 + 1);
    const x1 = Math.min(cols - 1, x0 + 1);
    const ty = fy - y0;
    const tx = fx - x0;

    const get = (r: number, c: number) => {
      const v = grid[r * cols + c];
      return v > 0 ? v : gridMean; // fill no-data with mean
    };

    const bilinear =
      get(y0, x0) * (1 - tx) * (1 - ty) +
      get(y0, x1) * tx * (1 - ty) +
      get(y1, x0) * (1 - tx) * ty +
      get(y1, x1) * tx * ty;

    // Correction factor: how much this pixel deviates from the mean
    // Values > 1 = higher-than-average NO₂ column → scale up NO₂ baseline
    // Clamped to [0.7, 1.5] to prevent extreme corrections
    return Math.max(0.7, Math.min(1.5, bilinear / gridMean));
  };
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

// ─── IQAir daily budget tracker ─────────────────────────────
// Community plan: 500 req/day, 10K/month. We set budget to 450 with 50 buffer.
async function canCallIQAir(): Promise<boolean> {
  const key = `iqair:budget:${new Date().toISOString().slice(0, 10)}`;
  const raw = await redisGet(key);
  const used = raw ? parseInt(raw, 10) : 0;
  return used < 450;
}

async function recordIQAirCall(): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const key = `iqair:budget:${new Date().toISOString().slice(0, 10)}`;
  try {
    await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetch(`${url}/expire/${encodeURIComponent(key)}/172800`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal */ }
}

// ─── IQAir cross-validation ─────────────────────────────────
// Fetches nearest city AQI from IQAir as third-party reference.
// Cached 1 hour (stations update hourly). Quantized to 0.5° grid (~55km).
interface IQAirData {
  aqius: number;
  aqicn: number;
  mainus: string;
  city: string;
  country: string;
  ts: string;
  weather: { tp: number; hu: number; ws: number; wd: number; pr: number } | null;
}

async function fetchIQAirCity(lat: number, lon: number): Promise<IQAirData | null> {
  const apiKey = process.env.IQAIR_API_KEY;
  if (!apiKey) return null;

  const q = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
  const cacheKey = `iqair:city:${q(lat)}:${q(lon)}`;

  const cached = await redisGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  if (!(await canCallIQAir())) return null;

  try {
    const resp = await fetch(
      `https://api.airvisual.com/v2/nearest_city?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&key=${encodeURIComponent(apiKey)}`
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.status !== 'success' || !json.data?.current?.pollution) return null;

    await recordIQAirCall();

    const { pollution, weather } = json.data.current;
    const result: IQAirData = {
      aqius: pollution.aqius,
      aqicn: pollution.aqicn,
      mainus: pollution.mainus || 'p2',
      city: json.data.city || '',
      country: json.data.country || '',
      ts: pollution.ts || '',
      weather: weather ? { tp: weather.tp, hu: weather.hu, ws: weather.ws, wd: weather.wd, pr: weather.pr } : null,
    };

    await redisSetEx(cacheKey, 3600, JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

// ─── IQAir cross-validation scoring ─────────────────────────
interface IQAirValidation {
  iqairAQI: number;
  iqairCity: string;
  confidenceAdj: number;
  validationStatus: 'cross-validated' | 'partially-validated' | 'divergent';
}

function crossValidateIQAir(vayuAQI: number, iqair: IQAirData): IQAirValidation {
  const diff = Math.abs(vayuAQI - iqair.aqius);
  const maxVal = Math.max(vayuAQI, iqair.aqius, 1);
  const pctDiff = diff / maxVal;

  let confidenceAdj: number;
  let validationStatus: IQAirValidation['validationStatus'];

  if (pctDiff < 0.10) {
    confidenceAdj = 1.0;
    validationStatus = 'cross-validated';
  } else if (pctDiff < 0.25) {
    confidenceAdj = 0.85;
    validationStatus = 'partially-validated';
  } else {
    confidenceAdj = 0.65;
    validationStatus = 'divergent';
  }

  return { iqairAQI: iqair.aqius, iqairCity: iqair.city, confidenceAdj, validationStatus };
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

  // Elevation correction: higher altitude = faster dispersion
  const elevFactor = elevationFactor(road.elevation_avg);

  let pm25Delta = gaussianConc(qPM25, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * jitter;
  let no2Delta  = gaussianConc(qNOx, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * jitter;

  // ── AI pollution factor override (from Gemini batch classification) ──
  // Gang/lorong gets ai_pollution_factor ~0.05-0.2, heavy traffic roads ~1.0-1.5
  if (road.ai_pollution_factor != null) {
    pm25Delta *= road.ai_pollution_factor;
    no2Delta  *= road.ai_pollution_factor;
  }

  // PM₁₀ = PM₂.₅ delta + coarse fraction (tire wear, brake dust, road dust)
  // Surface-dependent: unpaved roads generate much more resuspended dust
  const surfacePM10 = SURFACE_PM10_FACTOR[road.surface || ''] ?? 1.0;
  const pm10Delta = pm25Delta * 1.8 * surfacePM10;

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

// ─── Cache key from bbox (zoom-dependent coarse grid) ───────
function bboxCacheKey(south: number, west: number, north: number, east: number, zoom: number, forecastHour = 0): string {
  // Coarser quantization: ~2km grid (zoom-dependent) → many small pans = same key
  const step = Math.max(0.005, 0.5 / Math.pow(2, Math.max(0, zoom - 10)));
  const q = (v: number) => (Math.floor(v / step) * step).toFixed(4);
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

  // Limit bbox size based on zoom — allow 2× viewport for padding
  const maxSpan = z <= 11 ? 1.0 : z <= 12 ? 0.6 : 0.3;
  if (n - s > maxSpan || e - w > maxSpan) {
    return res.status(400).json({ error: 'Bounding box too large. Zoom in more.' });
  }

  try {
    const cacheKey = bboxCacheKey(s, w, n, e, z, fh);

    // Check Redis cache first
    const cached = await redisGet(cacheKey);
    if (cached) {
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
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
    const [bias, satNO2Interp, iqairData] = await Promise.all([
      fh === 0
        ? fetchWAQIBias(cLat, cLon, baselineCenter)
        : Promise.resolve({ pm25: 0, pm10: 0, no2: 0, o3: 0, stationName: null } as WAQIBias),
      fh === 0
        ? fetchSatelliteNO2(s, w, n, e)
        : Promise.resolve(null),
      fh === 0
        ? fetchIQAirCity(cLat, cLon)
        : Promise.resolve(null),
    ]);

    // Wrap interpolation with bias + satellite correction
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

    // Use forecast hour for diurnal profile: shift current hour by forecast offset
    const targetHour = (new Date().getHours() + fh) % 24;
    let diurnal = HOURLY_TRAFFIC[targetHour] ?? 1.0;

    // ── Region detection (used for temporal AI, WAQI history, error corrections) ──
    const region = detectRegion(cLat, cLon);
    const today = new Date().toISOString().slice(0, 10);

    // ── WAQI History Save (feeds Module B temporal learning) ──
    // Fire-and-forget: save hourly WAQI readings so Gemini can learn traffic patterns
    if (fh === 0 && bias.stationName) {
      (async () => {
        try {
          const histKey = `vayu:waqi_history:${region}:${today}`;
          const existing = await redisGet(histKey);
          const history = existing ? JSON.parse(existing) : {};
          history[targetHour] = {
            pm25: Math.round((baselineCenter.pm25 + bias.pm25) * 10) / 10,
            no2: Math.round((baselineCenter.no2 + bias.no2) * 10) / 10,
            o3: Math.round((baselineCenter.o3 + bias.o3) * 10) / 10,
            pm10: Math.round((baselineCenter.pm10 + bias.pm10) * 10) / 10,
            wind: baselineCenter.wind_speed,
            station: bias.stationName,
          };
          await redisSetEx(histKey, 691200, JSON.stringify(history)); // 8d TTL
        } catch { /* non-fatal */ }
      })();
    }

    // ── Temporal AI correction (Module B): blend AI-predicted hourly factors ──
    // Pre-computed by Gemini scheduled runs, cached in Redis
    if (fh === 0) {
      const temporalRaw = await redisGet(`vayu:temporal:${region}:${today}`);
      if (temporalRaw) {
        try {
          const tc = JSON.parse(temporalRaw);
          const aiFactor = tc.hourly_factors?.[targetHour];
          if (typeof aiFactor === 'number' && aiFactor > 0) {
            // Blend: 60% AI prediction + 40% static curve (safety net)
            diurnal = aiFactor * 0.6 + diurnal * 0.4;
          }
        } catch { /* use static diurnal */ }
      }
    }

    // ── Pre-fetch residual error corrections (Module C) ──
    // Cached correction factors from Gemini weekly analysis
    const errorCorrections = new Map<string, number>();
    if (fh === 0) {
      const hwClasses = [...new Set(filtered.map(r => r.highway))];
      await Promise.all(hwClasses.map(async (hw) => {
        const raw = await redisGet(`vayu:correction:${region}:${hw}:${targetHour}`);
        if (raw) {
          const f = parseFloat(raw);
          if (f > 0 && Math.abs(f - 1.0) > 0.01) errorCorrections.set(hw, f);
        }
      }));
    }

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

      let { aqi, pm25, no2, o3, pm10 } = computeRoadAQI(road, baseline, diurnal);

      // ── Apply residual error correction (Module C) ──
      const corrFactor = errorCorrections.get(road.highway);
      if (corrFactor) {
        pm25 = Math.round(pm25 * corrFactor * 100) / 100;
        no2 = Math.round(no2 * corrFactor * 100) / 100;
        pm10 = Math.round(pm10 * corrFactor * 100) / 100;
        aqi = pm25ToAQI(pm25);
      }

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

    // IQAir cross-validation: compare median road AQI vs IQAir city AQI
    let iqairValidation: IQAirValidation | null = null;
    if (iqairData && features.length > 0) {
      const sortedAQIs = features.map(f => f.aqi).sort((a, b) => a - b);
      const medianAQI = sortedAQIs[Math.floor(sortedAQIs.length / 2)];
      iqairValidation = crossValidateIQAir(medianAQI, iqairData);
    }

    // ── Log prediction errors (feeds Module C residual learning) ──
    // Fire-and-forget: accumulate predicted vs observed deltas for Gemini analysis
    if (fh === 0 && bias.stationName && features.length > 0) {
      (async () => {
        try {
          const observedAQI = iqairData?.aqius ?? pm25ToAQI(baselineCenter.pm25 + bias.pm25);
          const errKey = `vayu:errors:${region}:accumulated`;
          const raw = await redisGet(errKey);
          const errors: Array<{ road_class: string; hour: number; predicted_aqi: number; actual_aqi: number; delta: number; ts: string }> = raw ? JSON.parse(raw) : [];
          // Keep max 500 entries
          if (errors.length >= 500) errors.splice(0, errors.length - 450);
          // Average AQI per road class
          const classBuckets = new Map<string, { sum: number; n: number }>();
          for (const f of features) {
            const b = classBuckets.get(f.highway) || { sum: 0, n: 0 };
            b.sum += f.aqi; b.n++;
            classBuckets.set(f.highway, b);
          }
          for (const [rc, { sum, n }] of classBuckets) {
            const predicted = Math.round(sum / n);
            errors.push({ road_class: rc, hour: targetHour, predicted_aqi: predicted, actual_aqi: observedAQI, delta: predicted - observedAQI, ts: new Date().toISOString() });
          }
          await redisSetEx(errKey, 691200, JSON.stringify(errors)); // 8d TTL
        } catch { /* non-fatal */ }
      })();
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
        satellite_no2: !!satNO2Interp,
        iqair_aqi: iqairValidation?.iqairAQI ?? null,
        iqair_city: iqairValidation?.iqairCity ?? null,
        iqair_validation: iqairValidation?.validationStatus ?? null,
        iqair_confidence_adj: iqairValidation?.confidenceAdj ?? null,
        ai_enhanced: filtered.some(r => r.ai_pollution_factor != null || r.micro_class != null),
        computed_at: new Date().toISOString(),
      },
    };

    // Cache: 30 min for current, 60 min for forecast (AQ data changes hourly)
    await redisSetEx(cacheKey, fh > 0 ? 3600 : 1800, JSON.stringify(result));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);

  } catch (error) {
    console.error('VAYU road-aqi error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
