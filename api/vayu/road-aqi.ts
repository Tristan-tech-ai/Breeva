import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Inlined XGBoost residual inference (was api/vayu/_ml_inference.ts) ───
// Vercel's underscore-prefix exclusion blocks the file from being bundled even
// as a utility import (ERR_MODULE_NOT_FOUND at runtime), and the `functions.includeFiles`
// vercel.json knob does not solve it either. Inline keeps road-aqi self-contained.

interface XGBNode {
  nodeid?: number;
  split?: string;
  split_index?: number;
  split_condition?: number;
  yes?: XGBNode;
  no?: XGBNode;
  leaf?: number;
}

interface XGBoostModel {
  trees: XGBNode[];
  feature_names: string[];
  base_score: number;
}

const modelCache = new Map<string, { m: XGBoostModel | null; at: number }>();
const MODEL_TTL_MS = 30 * 60 * 1000;

async function fetchActiveModelMeta(region: string): Promise<{ url: string; version: string } | null> {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return null;
  const tryUrl = async (regionFilter: string) => {
    const r = await fetch(
      `${supaUrl}/rest/v1/ml_model_registry?model_name=eq.caline3_residual&active=eq.true&${regionFilter}&select=artifact_url,version&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ artifact_url: string; version: string }>;
    return rows[0] ?? null;
  };
  const regSpecific = await tryUrl(`region=eq.${encodeURIComponent(region)}`);
  if (regSpecific?.artifact_url) return { url: regSpecific.artifact_url, version: regSpecific.version };
  const globalModel = await tryUrl('region=is.null');
  if (globalModel?.artifact_url) return { url: globalModel.artifact_url, version: globalModel.version };
  return null;
}

function normalizeXgboostJson(raw: unknown): XGBoostModel | null {
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r?.trees) && Array.isArray(r?.feature_names)) {
    return {
      trees: r.trees as XGBNode[],
      feature_names: r.feature_names as string[],
      base_score: typeof r.base_score === 'number' ? r.base_score : 0.0,
    };
  }
  const learner = r?.learner as Record<string, unknown> | undefined;
  const gb = learner?.gradient_booster as Record<string, unknown> | undefined;
  const gbModel = gb?.model as Record<string, unknown> | undefined;
  const trees = gbModel?.trees;
  const fnames = (learner?.feature_names as string[]) ?? [];
  if (Array.isArray(trees) && trees.length > 0) {
    const lmp = learner?.learner_model_param as Record<string, unknown> | undefined;
    return {
      trees: trees as XGBNode[],
      feature_names: fnames,
      base_score: Number(lmp?.base_score ?? 0.0),
    };
  }
  return null;
}

async function loadModel(region: string): Promise<XGBoostModel | null> {
  const cached = modelCache.get(region);
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.m;
  const meta = await fetchActiveModelMeta(region);
  if (!meta) {
    modelCache.set(region, { m: null, at: Date.now() });
    return null;
  }
  try {
    const r = await fetch(meta.url, { headers: { 'cache-control': 'no-store' } });
    if (!r.ok) {
      modelCache.set(region, { m: null, at: Date.now() });
      return null;
    }
    const raw = await r.json();
    const m = normalizeXgboostJson(raw);
    modelCache.set(region, { m, at: Date.now() });
    return m;
  } catch {
    modelCache.set(region, { m: null, at: Date.now() });
    return null;
  }
}

function traverseTree(rootNode: XGBNode, features: Record<string, number>, fnames: string[]): number {
  let node = rootNode;
  while (true) {
    if (node.leaf !== undefined) return node.leaf;
    const fkey = node.split ?? fnames[node.split_index ?? 0];
    const value = features[fkey] ?? 0;
    const threshold = node.split_condition ?? 0;
    if (value < threshold) {
      if (!node.yes) return 0;
      node = node.yes;
    } else {
      if (!node.no) return 0;
      node = node.no;
    }
  }
}

async function applyResidualCorrection(
  region: string,
  rawPrediction: number,
  features: Record<string, number>,
): Promise<{ corrected: number; residual: number; model_version: string | null }> {
  const model = await loadModel(region);
  if (!model) return { corrected: rawPrediction, residual: 0, model_version: null };
  const fullFeatures = { ...features, predicted_pm25: rawPrediction };
  let residual = model.base_score;
  for (const tree of model.trees) {
    residual += traverseTree(tree, fullFeatures, model.feature_names);
  }
  const corrected = Math.max(0, rawPrediction + residual);
  return { corrected, residual, model_version: 'active' };
}

async function logPrediction(p: {
  osm_way_id: number;
  cell_id?: string;
  region: string;
  predicted_pm25: number;
  corrected_pm25: number | null;
  features: Record<string, number>;
}): Promise<void> {
  const sampleRate = Number(process.env.PREDICTION_LOG_SAMPLE ?? '0.1');
  if (sampleRate <= 0) return;
  if (Math.random() > sampleRate) return;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return;
  try {
    await fetch(`${supaUrl}/rest/v1/prediction_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(p),
    });
  } catch {
    // non-fatal
  }
}
// ─── end inlined ml_inference ───

// ─── Tier 3.5: GCN spatial delta lookup ─────────────────────
// Fetches precomputed deltas from public.v_gcn_predictions_current via RPC
// get_gcn_deltas(BIGINT[]). Falls back to 0 (no delta) when no cache hit.
// Cache lifetime 10 min — matches nightly precompute cadence.

interface GcnDelta {
  pm25_delta_gcn: number;
  uncertainty_sigma: number;
}

const gcnDeltaCache = new Map<number, { d: GcnDelta | null; at: number }>();
const GCN_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchGcnDeltasBatch(osmWayIds: number[]): Promise<Map<number, GcnDelta>> {
  const result = new Map<number, GcnDelta>();
  if (osmWayIds.length === 0) return result;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return result;

  const now = Date.now();
  const need: number[] = [];
  for (const wid of osmWayIds) {
    const cached = gcnDeltaCache.get(wid);
    if (cached && now - cached.at < GCN_CACHE_TTL_MS) {
      if (cached.d) result.set(wid, cached.d);
    } else {
      need.push(wid);
    }
  }
  if (need.length === 0) return result;

  try {
    const r = await fetch(`${supaUrl}/rest/v1/rpc/get_gcn_deltas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
      },
      body: JSON.stringify({ p_osm_way_ids: need }),
    });
    if (!r.ok) return result;
    const rows = (await r.json()) as Array<{
      osm_way_id: number; pm25_delta_gcn: number; uncertainty_sigma: number;
    }>;
    for (const row of rows) {
      const d: GcnDelta = {
        pm25_delta_gcn: row.pm25_delta_gcn,
        uncertainty_sigma: row.uncertainty_sigma,
      };
      result.set(row.osm_way_id, d);
      gcnDeltaCache.set(row.osm_way_id, { d, at: now });
    }
    // mark cache-miss osm_ids as null to suppress retry storms
    for (const wid of need) {
      if (!result.has(wid)) gcnDeltaCache.set(wid, { d: null, at: now });
    }
  } catch {
    // non-fatal — return whatever we have
  }
  return result;
}
// ─── end GCN spatial delta ───

/**
 * VAYU Road-AQI Endpoint — Returns per-road-segment pollution data for a bbox.
 * Used by RoadPollutionLayer to render eLichens-style colored road polylines.
 *
 * GET /api/vayu/road-aqi?south=&west=&north=&east=&zoom=
 *
 * Flow: bbox → find_roads_in_bbox RPC → compute per-road AQI → Redis cache → respond
 */

const VAYU_VERSION = '1.0.1'; // force Vercel rebuild after force-push cycle

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
    case 'motorway_link': case 'trunk_link': return 4;
    case 'primary': return 4;
    case 'primary_link': return 3.5;
    case 'secondary': return 3.5;
    case 'secondary_link': return 3;
    case 'tertiary': return 3;
    case 'tertiary_link': return 2.5;
    case 'residential': return 2.5;
    default: return 2;
  }
}

// ─── Zoom-based road query params (LOD: Level of Detail) ────
// Progressive reveal: big roads first, then medium, then small.
// Prevents payload bloat and keeps rendering clean at each zoom level.
//
// LIMITs sized for DB-side highway filtering (migration 004 applied).
// JS safety-net filter still present as belt-and-suspenders.
function getQueryParams(zoom: number): { limit: number; highways: string[] | null; simplify: number } {
  // z16+: ALL roads — gang, lorong, service, footway.
  // Limit raised to 25k after PostgREST Range header unblocked
  // db-max-rows=1000 cap. Aggressive simplify (~2m tolerance) at this zoom
  // is invisible (street level) but trims geometry payload by ~30-40%.
  if (zoom >= 16) return { limit: 25000, highways: null, simplify: 0.00002 };
  // z15: + residential, living_street, unclassified
  if (zoom >= 15) return { limit: 18000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link',
    'residential', 'living_street', 'unclassified',
  ], simplify: 0.00005 };
  // z14: + tertiary (medium roads)
  if (zoom >= 14) return { limit: 12000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link',
  ], simplify: 0.0001 };
  // z13: primary + secondary
  if (zoom >= 13) return { limit: 5000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
  ], simplify: 0.0001 };
  // z12: primary + secondary
  if (zoom >= 12) return { limit: 3000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
  ], simplify: 0.0002 };
  // z11: motorway, trunk, primary
  if (zoom >= 11) return { limit: 2000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link',
  ], simplify: 0.0005 };
  // z10: motorway, trunk only
  return { limit: 1000, highways: [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
  ], simplify: 0.0005 };
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

// ─── Phase 1.3: per-region CALINE3 static priors ─────────────
// Loaded from public.caline3_region_params (seeded for 17 regions, see
// migration `caline3_region_params`). Cached in process memory for 1 hour.
// Real-time wind from Open-Meteo overrides region wind_speed_dry/wet (they
// are kept for offline scenarios / fallback only).
interface RegionCaline3Params {
  surface_roughness: number;    // 0..1.5 — urban dense ~0.9, suburban ~0.5, rural ~0.4
  stability_morning: number;    // Pasquill class 1..6 (low = unstable, high = stable)
  stability_afternoon: number;
  stability_night: number;
  inversion_height_dry: number; // metres
  inversion_height_wet: number;
  mean_elevation_m: number;
}

const REGION_PARAMS_DEFAULT: RegionCaline3Params = {
  surface_roughness: 0.5,
  stability_morning: 3.0,
  stability_afternoon: 2.0,
  stability_night: 5.0,
  inversion_height_dry: 800,
  inversion_height_wet: 1200,
  mean_elevation_m: 50,
};

const regionParamsCache = new Map<string, { p: RegionCaline3Params; at: number }>();
const REGION_PARAMS_TTL_MS = 60 * 60 * 1000;

async function getRegionParams(region: string): Promise<RegionCaline3Params> {
  const cached = regionParamsCache.get(region);
  if (cached && Date.now() - cached.at < REGION_PARAMS_TTL_MS) return cached.p;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return REGION_PARAMS_DEFAULT;
  try {
    const r = await fetch(
      `${url}/rest/v1/caline3_region_params?region=eq.${encodeURIComponent(region)}&select=surface_roughness,stability_morning,stability_afternoon,stability_night,inversion_height_dry,inversion_height_wet,mean_elevation_m&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return REGION_PARAMS_DEFAULT;
    const rows = await r.json();
    if (rows.length === 0) return REGION_PARAMS_DEFAULT;
    const p = rows[0] as RegionCaline3Params;
    regionParamsCache.set(region, { p, at: Date.now() });
    return p;
  } catch {
    return REGION_PARAMS_DEFAULT;
  }
}

function timeOfDayKey(): 'morning' | 'afternoon' | 'night' {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'night';
}

function currentSeason(): 'dry' | 'wet' {
  const m = new Date().getMonth() + 1;
  return m >= 5 && m <= 10 ? 'dry' : 'wet';
}

// Derived multiplier on dispersion delta from region calibration.
// surface_roughness > 0.5: urban → less ventilation → multiplier >1 (more concentration)
// stability factor: Pasquill A(1)=very unstable, F(6)=very stable; higher = more
//   concentration (less mixing) → multiplier scales linearly 0.7..1.4
// inversion_height < road delta + baseline → trap, slight boost
function regionDispersionMultiplier(p: RegionCaline3Params): number {
  const roughnessFactor = 1.0 + 0.4 * (p.surface_roughness - 0.5);  // 0.4→0.96, 0.9→1.16
  const tod = timeOfDayKey();
  const stab = tod === 'morning' ? p.stability_morning
    : tod === 'afternoon' ? p.stability_afternoon
    : p.stability_night;
  const stabilityFactor = 0.7 + 0.12 * (stab - 1.0);  // class 1→0.7, class 6→1.3
  const season = currentSeason();
  const invH = season === 'dry' ? p.inversion_height_dry : p.inversion_height_wet;
  const inversionFactor = invH < 600 ? 1.15 : invH < 900 ? 1.05 : 1.0;
  return roughnessFactor * stabilityFactor * inversionFactor;
}

// ─── Phase 1.4: TomTom traffic_calibration lookup ───────────
// Aggregated per (region, road_class, hour_of_day, day_of_week).
// Populated by vayu/calibration/tomtom_sampler.py (Windows Task hourly).
// Returns Map<highway_class → correction_factor>; missing classes default 1.0.
// ─── Phase 1.2: aqi_grid_sentinel freshness lookup ───────────
// Returns age in hours (or null) of most recent Sentinel-5P data within bbox.
// Used by confidence scoring: fresh satellite data boosts confidence by ~0.3.
async function getSentinelAgeHours(
  south: number, west: number, north: number, east: number,
): Promise<number | null> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(
      `${url}/rest/v1/aqi_grid_sentinel?centroid_lat=gte.${south}&centroid_lat=lte.${north}` +
      `&centroid_lng=gte.${west}&centroid_lng=lte.${east}` +
      `&select=sentinel_acquired_at&order=sentinel_acquired_at.desc&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ sentinel_acquired_at: string }>;
    if (rows.length === 0 || !rows[0].sentinel_acquired_at) return null;
    const ageMs = Date.now() - new Date(rows[0].sentinel_acquired_at).getTime();
    return ageMs / (60 * 60 * 1000);
  } catch {
    return null;
  }
}

async function fetchTrafficCorrections(
  _region: string, hourOfDay: number, dayOfWeek: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return out;
  try {
    // Note: traffic_calibration in seeded form keys on (road_class,hour,dow) without region;
    // the table also has 'region' if a column was added later. Query is region-agnostic
    // fallback when region filter returns 0 rows.
    const baseUrl =
      `${url}/rest/v1/traffic_calibration?hour_of_day=eq.${hourOfDay}&day_of_week=eq.${dayOfWeek}` +
      `&select=road_class,correction_factor,sample_count`;
    const r = await fetch(baseUrl, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return out;
    const rows = await r.json() as Array<{ road_class: string; correction_factor: number; sample_count: number }>;
    for (const row of rows) {
      // Only trust rows with enough samples; otherwise default-1.0 wins
      if (row.sample_count >= 1 && row.correction_factor > 0) {
        out.set(row.road_class, row.correction_factor);
      }
    }
    return out;
  } catch {
    return out;
  }
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
  // D1: road-only contribution above baseline (CALINE3 dispersion delta).
  // Use these for "Show road contribution" toggle in RoadPollutionLayer —
  // makes road-level resolution visible without baseline drowning out variance.
  pm25_delta: number;
  no2_delta: number;
  pm10_delta: number;
  highway: string;
  weight: number;
  // True kalau ai_pollution_factor real dari Gemini; false kalau deterministic
  // hash fallback (C1 stopgap). UI bisa surface badge "AI-classified" untuk
  // jalan dengan ai_classified=true.
  ai_classified: boolean;
  // Phase 1.1: 0..1 confidence in AQI estimate. Blends station distance,
  // satellite freshness, model availability, crowdsource count, plus a small
  // per-road boost when ai_pollution_factor is real (vs hash fallback).
  confidence_score: number;
  // Tier 3.5 / Tier 4.0: GraphSAGE spatial delta layered after CALINE3+XGBoost.
  // pm25_delta stays = XGB residual only (existing semantics). gcn_delta is the
  // GCN-only delta over (CALINE3+XGB). pm25_total_delta = pm25_delta + gcn_delta
  // — the combined uplift over CALINE3 raw.
  gcn_applied?: boolean;
  gcn_delta?: number;
  gcn_uncertainty?: number;
  pm25_total_delta?: number;
}

// Local mirror of Postgres compute_aqi_confidence() — same formula, no RTT cost.
function computeAqiConfidenceLocal(args: {
  has_station: boolean; station_distance_km: number;
  has_satellite: boolean; satellite_age_hours: number;
  has_model: boolean; has_crowdsource: boolean; crowdsource_count: number;
}): number {
  let s = 0;
  if (args.has_station) s += Math.max(0.1, 0.5 * Math.exp(-(args.station_distance_km ?? 99) / 8));
  if (args.has_satellite) s += Math.max(0.05, 0.3 * Math.exp(-(args.satellite_age_hours ?? 99) / 12));
  if (args.has_model) s += 0.2;
  if (args.has_crowdsource && args.crowdsource_count > 0) s += Math.min(0.2, 0.05 * args.crowdsource_count);
  return Math.max(0, Math.min(1, s));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Open-Meteo BATCH fetch (5 points in 2 HTTP calls) ─────
// Uses Open-Meteo's multi-coordinate support: latitude=l1,l2,...&longitude=ln1,ln2,...
// Reduces 10 HTTP requests → 2, saving ~300-400ms per viewport.

interface BaselineData {
  pm25: number; pm10: number; no2: number;
  co: number; o3: number; wind_speed: number;
}

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
    // Multi-point returns array; single-point returns object
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

  // Forecast mode
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

// ─── Multi-point baseline grid with Redis cache ─────────────
// Fetches 5 points (center + 4 corners) for spatial interpolation.
// Cached in Redis for 15 min at coarse ~0.1° grid → most viewport moves = cache HIT.
async function fetchBaselineGrid(south: number, west: number, north: number, east: number, forecastHour = 0) {
  const cLat = (south + north) / 2;
  const cLon = (west + east) / 2;

  // Quantize center to 0.1° grid (~11km) so zoom changes + 15% padding
  // don't shift the grid center, keeping colors stable across zoom transitions
  const qLat = Math.round(cLat * 10) / 10;
  const qLon = Math.round(cLon * 10) / 10;
  const OFFSET = 0.1; // Fixed offset for corner sample points

  const baselineCacheKey = `vayu:bl:${qLat.toFixed(2)}:${qLon.toFixed(2)}:fh${forecastHour}`;

  // Fixed grid bounds for interpolation (zoom-independent)
  const gS = qLat - OFFSET, gN = qLat + OFFSET;
  const gW = qLon - OFFSET, gE = qLon + OFFSET;

  // Check Redis cache first (15 min TTL)
  const cachedBaseline = await redisGet(baselineCacheKey);
  if (cachedBaseline) {
    try {
      const { center, nw, ne, sw, se } = JSON.parse(cachedBaseline) as {
        center: BaselineData; nw: BaselineData; ne: BaselineData;
        sw: BaselineData; se: BaselineData;
      };
      const interpolate = buildInterpolator(gS, gW, gN, gE, center, nw, ne, sw, se);
      return { center, interpolate };
    } catch { /* fall through to fetch */ }
  }

  // Batch fetch: 5 fixed points in 2 HTTP calls (instead of 10)
  const lats = [qLat, gN, gN, gS, gS];
  const lons = [qLon, gW, gE, gW, gE];
  const results = await fetchBaselineBatch(lats, lons, forecastHour);
  const [center, nw, ne, sw, se] = results;

  // Cache for 15 min
  await redisSetEx(baselineCacheKey, 900, JSON.stringify({ center, nw, ne, sw, se }));

  const interpolate = buildInterpolator(gS, gW, gN, gE, center, nw, ne, sw, se);
  return { center, interpolate };
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
  // Phase 1.1: distance from station to viewport center, when station available.
  // Null = no station found within reasonable radius. Drives confidence_score.
  stationDistanceKm: number | null;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  stationName: string | null;
}

async function fetchWAQIBias(lat: number, lon: number, openMeteoBaseline: BaselineData): Promise<WAQIBias> {
  const noBias: WAQIBias = { pm25: 0, pm10: 0, no2: 0, o3: 0, stationName: null, stationDistanceKm: null };

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
    // Phase 1.1: compute distance to viewport center for confidence scoring.
    const geo = json.data.city?.geo;
    const stationDistanceKm = Array.isArray(geo) && typeof geo[0] === 'number' && typeof geo[1] === 'number'
      ? haversineKm(lat, lon, geo[0], geo[1])
      : null;

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
      stationDistanceKm,
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
  south: number, west: number, north: number, east: number,
  limit: number, _simplifyTolerance = 0, highwayTypes: string[] | null = null
): Promise<RoadRow[]> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const params: Record<string, unknown> = { south, west, north, east, road_limit: limit };
    if (_simplifyTolerance > 0) params.simplify_tolerance = _simplifyTolerance;
    if (highwayTypes) params.highway_types = highwayTypes;
    // PostgREST default db-max-rows = 1000 — caps RPC result regardless of
    // the function's internal LIMIT. The "Range" header overrides this cap
    // up to the requested upper bound. Without this header, dense urban
    // viewports (>1000 roads) get truncated, leaving half the map blank.
    const upper = Math.max(0, limit - 1);
    const resp = await fetch(`${url}/rest/v1/rpc/find_roads_in_bbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Range-Unit': 'items',
        Range: `0-${upper}`,
      },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      // Fallback: retry without new params if migration not applied
      if (highwayTypes || _simplifyTolerance > 0) {
        return findRoadsInBbox(south, west, north, east, limit, 0, null);
      }
      return [];
    }
    return await resp.json();
  } catch { return []; }
}

// ─── C1 stopgap: deterministic hash-based ai_pollution_factor fallback ───
// 98% of road_segments rows have ai_pollution_factor=null (Gemini batch not
// yet run for most regions). Falling back to 1.0 makes all roads in same
// highway class collapse to the same dispersion delta after CALINE3.
//
// Solution: derive a *stable* per-road factor from osm_way_id hash within a
// realistic class-specific [min, max] range that mirrors Gemini batch output.
// Stable = same factor every render (no flicker on pan/zoom).
//
// This is documented as a stopgap until A1 (Gemini batch classify) finishes
// populating the real ai_pollution_factor column. See
// eve/diagnostics/road-aqi-resolution-collapse.md §V Treatment Path.
function aiFactorFallback(osmWayId: number, highway: string): number {
  // Knuth multiplicative hash → uniform [0, 1)
  const hash = (((osmWayId >>> 0) * 2654435761) >>> 0) / 4294967296;
  // Class-specific range mirroring Gemini's typical output for batches that
  // HAVE been classified. Source: existing classified rows in Bali region
  // (11,483 rows), grouped by highway × ai_pollution_factor.
  const RANGES: Record<string, [number, number]> = {
    motorway: [1.3, 1.8], motorway_link: [1.1, 1.5],
    trunk: [1.2, 1.7], trunk_link: [1.0, 1.4],
    primary: [1.0, 1.5], primary_link: [0.9, 1.3],
    secondary: [0.9, 1.3], secondary_link: [0.8, 1.2],
    tertiary: [0.7, 1.1], tertiary_link: [0.6, 1.0],
    residential: [0.5, 1.0],
    unclassified: [0.4, 0.9],
    living_street: [0.25, 0.6],
    service: [0.2, 0.5],
    pedestrian: [0.1, 0.3],
    footway: [0.05, 0.2],
    cycleway: [0.05, 0.2],
    path: [0.05, 0.2],
  };
  const [min, max] = RANGES[highway] || [0.5, 1.0];
  return min + hash * (max - min);
}

// ─── Compute per-road AQI ───────────────────────────────────
function computeRoadAQI(
  road: RoadRow,
  baseline: { pm25: number; pm10: number; no2: number; o3: number; wind_speed: number },
  diurnal: number,
  regionMultiplier: number = 1.0,           // Phase 1.3: per-region CALINE3 calibration
  trafficCorrections?: Map<string, number>, // Phase 1.4: TomTom-derived correction per road class
): {
  aqi: number; pm25: number; no2: number; o3: number; pm10: number;
  pm25_delta: number; no2_delta: number; pm10_delta: number;
  ai_classified: boolean;
} {
  const traffic = estimateTraffic(road, diurnal);

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

  // Narrower roads trap pollution more (8m reference width) — scaled by traffic so empty gang roads aren't penalized
  const rawWidthFactor = road.width ? Math.max(0.8, Math.min(1.5, 8.0 / road.width)) : 1.0;
  const widthFactor = traffic > 50 ? rawWidthFactor : 1.0 + (rawWidthFactor - 1.0) * Math.min(1, traffic / 50);

  // Elevation correction: higher altitude = faster dispersion
  const elevFactor = elevationFactor(road.elevation_avg);

  // Phase 1.4: TomTom-derived correction factor per (road_class, hour, dow).
  // 1.0 = free flow (no extra emission). >1.0 = congested (idle + low-gear =
  // higher emission per km). Lookup is per-road's highway class — falls back
  // to 1.0 if no calibration data for this (region, class, hour, dow).
  const trafficCorr = trafficCorrections?.get(road.highway) ?? 1.0;

  let pm25Delta = gaussianConc(qPM25, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * regionMultiplier * trafficCorr;
  let no2Delta  = gaussianConc(qNOx, effectiveWind, dist, 0.5) * veg * canyonTrap * widthFactor * elevFactor * regionMultiplier * trafficCorr;

  // ── AI pollution factor: real Gemini classification OR deterministic
  //    hash fallback (C1 stopgap until Gemini batch classifies this region).
  //    Gang/lorong gets factor ~0.05-0.4, residential ~0.5-1.1, heavy traffic ~1.2-1.8.
  const aiClassified = road.ai_pollution_factor != null;
  const aiFactor = aiClassified
    ? road.ai_pollution_factor!
    : aiFactorFallback(road.osm_way_id, road.highway || 'residential');
  pm25Delta *= aiFactor;
  no2Delta  *= aiFactor;

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
    pm25_delta: Math.round(pm25Delta * 100) / 100,
    no2_delta: Math.round(no2Delta * 100) / 100,
    pm10_delta: Math.round(pm10Delta * 100) / 100,
    ai_classified: aiClassified,
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

  // Cron auth guard (Migration 0012 — pg_cron → Vercel webhook).
  // If header is present, it MUST match BREEVA_CRON_SECRET. Absent header
  // means a normal user request — continue without auth.
  // .trim() defends against env vars that ship with stray whitespace/newlines.
  const cronSecret = (req.headers['x-breeva-cron-secret'] as string | undefined)?.trim();
  const expectedSecret = process.env.BREEVA_CRON_SECRET?.trim();
  if (cronSecret && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  // Dispatch: ?osm_way_id=... (without bbox) returns AI narrative for that road.
  // Merged from former api/vayu/road-narrative.ts to stay under Hobby plan's 12-function cap.
  if (req.query.osm_way_id && !req.query.south) {
    return handleNarrativeLookup(req, res);
  }

  const { south, west, north, east, zoom, forecast_hour } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(200).json({ roads: [], meta: { reason: 'missing_params', count: 0 } });
  }

  const s = parseFloat(south as string);
  const w = parseFloat(west as string);
  const n = parseFloat(north as string);
  const e = parseFloat(east as string);
  const z = parseInt(zoom as string) || 15;
  const fh = Math.max(0, Math.min(24, parseInt(forecast_hour as string) || 0));

  // Validate coordinates
  if ([s, w, n, e].some(isNaN) || s > n || w > e) {
    return res.status(200).json({ roads: [], meta: { reason: 'invalid_bbox', count: 0 } });
  }

  // Safety-net bbox size limit — return empty 200 (never 400) for absurdly large bboxes.
  const latSpan = n - s;
  const lngSpan = e - w;
  const maxSpan = z <= 10 ? 6.0
               : z <= 11 ? 3.0
               : z <= 12 ? 1.5
               : z <= 13 ? 0.8
               : z <= 14 ? 0.4
               : 0.25;

  if (latSpan > maxSpan || lngSpan > maxSpan) {
    return res.status(200).json({
      roads: [],
      meta: { reason: 'bbox_too_large', zoom: z, latSpan, lngSpan, maxSpan, version: VAYU_VERSION },
    });
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

    // Query road segments in viewport — pass highway filter to DB
    const { limit, highways, simplify } = getQueryParams(z);
    const roads = await findRoadsInBbox(s, w, n, e, limit, simplify, highways);

    if (roads.length === 0) {
      const empty = { roads: [], meta: { count: 0, zoom: z, wind_speed: 0 } };
      res.setHeader('Cache-Control', 's-maxage=120');
      return res.status(200).json(empty);
    }

    // Highway filter: applied in DB if migration ran (highway_types param),
    // otherwise fallback stripped it → re-apply in JS as safety net.
    const filtered = highways
      ? roads.filter((r) => highways.includes(r.highway))
      : roads;

    // Diagnostic: track filter efficiency to verify DB-side vs JS-side filtering
    if (highways && roads.length !== filtered.length) {
      console.log(`[vayu] z${z} filter: ${roads.length} from DB → ${filtered.length} after JS filter (${Math.round(100 - filtered.length / roads.length * 100)}% discarded — run SQL migration to fix)`);
    }

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

    // ── Phase 1.3: per-region CALINE3 static priors (cached 1h) ──
    const regionParams = await getRegionParams(region);
    const regionMultiplier = regionDispersionMultiplier(regionParams);

    // ── Phase 1.4: TomTom traffic corrections per highway class ──
    // Aggregate cached in DB by tomtom_sampler.py. Looked up by current (hour, dow).
    const nowJkt = new Date();
    const trafficCorrections = await fetchTrafficCorrections(
      region,
      nowJkt.getHours(),
      nowJkt.getDay(),
    );

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

    // Phase 1.1+1.2: region-level confidence baseline. WAQI station presence
    // + distance dominate; Sentinel-5P freshness now wired via aqi_grid_sentinel.
    const sentAgeHours = await getSentinelAgeHours(s, w, n, e);
    const regionConfidence = computeAqiConfidenceLocal({
      has_station: bias.stationName != null,
      station_distance_km: bias.stationDistanceKm ?? 99,
      has_satellite: sentAgeHours != null && sentAgeHours < 72,
      satellite_age_hours: sentAgeHours ?? 99,
      has_model: true,
      has_crowdsource: false,
      crowdsource_count: 0,
    });

    // Compute per-road AQI with spatially interpolated baseline
    const features: RoadAQIFeature[] = [];
    for (const road of filtered) {
      let geometry: { type: string; coordinates: number[][] };
      try {
        geometry = JSON.parse(road.geojson);
      } catch { continue; }

      // Truncate coordinates to 5 decimals (~1.1m precision)
      // Reduces payload by ~40% (Supabase returns 15 decimals)
      geometry.coordinates = geometry.coordinates.map(
        ([lon, lat, ...rest]) => rest.length > 0
          ? [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, ...rest]
          : [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
      );

      // Get road centroid for baseline interpolation
      const coords = geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      const roadLon = mid[0];
      const roadLat = mid[1];
      const baseline = interpCorrected(roadLat, roadLon);

      let { aqi, pm25, no2, o3, pm10, pm25_delta, no2_delta, pm10_delta, ai_classified } =
        computeRoadAQI(road, baseline, diurnal, regionMultiplier, trafficCorrections);

      // ── Phase 2.1: XGBoost residual correction ──
      // Loaded from ml_model_registry (active row per region OR global). If no
      // model is registered yet, returns identity (no change). Adds ~1ms per road
      // when model cached; cold-start <50ms.
      const rawPm25 = pm25;
      const mlFeatures = {
        canyon_ratio: road.canyon_ratio ?? 0,
        traffic_base_estimate: road.traffic_base_estimate ?? 100,
        hour_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
        is_weekend: new Date().getDay() >= 5 ? 1 : 0,
        congestion_factor: trafficCorrections?.get(road.highway) ?? 1.0,
        sentinel_pm25_proxy: 0,
        // Highway one-hot (sparse but inference-friendly)
        hw_motorway: road.highway === 'motorway' ? 1 : 0,
        hw_trunk: road.highway === 'trunk' ? 1 : 0,
        hw_primary: road.highway === 'primary' ? 1 : 0,
        hw_secondary: road.highway === 'secondary' ? 1 : 0,
        hw_tertiary: road.highway === 'tertiary' ? 1 : 0,
        hw_residential: road.highway === 'residential' ? 1 : 0,
        hw_service: road.highway === 'service' ? 1 : 0,
      };
      const { corrected, residual: mlResidual } = await applyResidualCorrection(region, pm25, mlFeatures);
      if (mlResidual !== 0) {
        pm25 = Math.round(corrected * 100) / 100;
        pm25_delta = Math.round((pm25 - baseline.pm25) * 100) / 100;
        aqi = pm25ToAQI(pm25);
      }

      // Fire-and-forget log of (raw prediction, features) for retraining corpus.
      // Sampling rate controlled by PREDICTION_LOG_SAMPLE env (default 10%).
      void logPrediction({
        osm_way_id: road.osm_way_id,
        region,
        predicted_pm25: rawPm25,
        corrected_pm25: mlResidual !== 0 ? pm25 : null,
        features: mlFeatures,
      });

      // ── Apply residual error correction (Module C) ──
      // Note: corrFactor scales the absolute concentration (baseline+delta).
      // We scale deltas proportionally so they remain consistent with totals.
      const corrFactor = errorCorrections.get(road.highway);
      if (corrFactor) {
        pm25 = Math.round(pm25 * corrFactor * 100) / 100;
        no2 = Math.round(no2 * corrFactor * 100) / 100;
        pm10 = Math.round(pm10 * corrFactor * 100) / 100;
        pm25_delta = Math.round(pm25_delta * corrFactor * 100) / 100;
        no2_delta = Math.round(no2_delta * corrFactor * 100) / 100;
        pm10_delta = Math.round(pm10_delta * corrFactor * 100) / 100;
        aqi = pm25ToAQI(pm25);
      }

      // Per-road confidence: region baseline + ai_classified boost (real Gemini
      // classification = more reliable emission factor estimate).
      const confidence_score = Math.min(1, regionConfidence + (ai_classified ? 0.1 : 0));

      features.push({
        osm_way_id: road.osm_way_id,
        geometry,
        aqi,
        pm25,
        no2,
        o3,
        pm10,
        pm25_delta,
        no2_delta,
        pm10_delta,
        highway: road.highway,
        weight: roadWeight(road.highway),
        ai_classified,
        confidence_score,
      });
    }

    // ── Tier 3.5: layer GraphSAGE spatial delta on top of CALINE3 + XGBoost ──
    // Single batched RPC for all roads in this viewport. If model hasn't been
    // precomputed for an osm_way_id (cold zone), feature stays unchanged.
    try {
      const osmIds = features.map(f => f.osm_way_id);
      const gcnMap = await fetchGcnDeltasBatch(osmIds);
      if (gcnMap.size > 0) {
        for (const f of features) {
          const gcn = gcnMap.get(f.osm_way_id);
          if (!gcn) {
            f.gcn_applied = false;
            continue;
          }
          // Tier 4.0 composition: GCN trained on (truth - corrected_pm25).
          // CALINE3 + XGB already applied to f.pm25. Layer GCN delta on top.
          // Keep f.pm25_delta = XGB residual ONLY (existing semantic — no double-count).
          const xgbResidualDelta = f.pm25_delta;
          const gcnDelta = gcn.pm25_delta_gcn;
          const correctedPm25 = f.pm25;
          const newPm25 = Math.max(0, correctedPm25 + gcnDelta);
          f.pm25 = Math.round(newPm25 * 100) / 100;
          f.aqi = pm25ToAQI(f.pm25);
          // pm25_delta stays untouched; explicit gcn_delta + combined total
          f.gcn_delta = Math.round(gcnDelta * 100) / 100;
          f.pm25_total_delta = Math.round((xgbResidualDelta + gcnDelta) * 100) / 100;
          // confidence modulated by predicted sigma (cap 30% penalty)
          const penalty = Math.min(0.3, gcn.uncertainty_sigma / 20);
          f.confidence_score = Math.max(0.1, Math.round(f.confidence_score * (1 - penalty) * 100) / 100);
          f.gcn_applied = true;
          f.gcn_uncertainty = Math.round(gcn.uncertainty_sigma * 100) / 100;
        }
      }
    } catch {
      // non-fatal — Tier 3.5 is additive
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
    const payload = JSON.stringify(result);
    const sizeKB = Math.round(payload.length / 1024);
    console.log(`[vayu] z${z} roads=${result.roads.length} payload=${sizeKB}KB`);
    if (sizeKB > 4000) {
      console.warn(`[vayu] WARNING: payload ${sizeKB}KB approaching Vercel 4.5MB limit`);
    }
    await redisSetEx(cacheKey, fh > 0 ? 3600 : 1800, payload);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Road-Count', String(result.roads.length));
    res.setHeader('X-Payload-KB', String(sizeKB));
    return res.status(200).json(result);

  } catch (error) {
    console.error('VAYU road-aqi error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}

interface NarrativeRow {
  osm_way_id: number;
  name: string | null;
  highway: string;
  region: string;
  ai_narrative: string | null;
  ai_narrative_grounded_at: string | null;
  ai_narrative_sources: unknown;
}

async function handleNarrativeLookup(req: VercelRequest, res: VercelResponse) {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: 'Supabase env missing' });
  }

  const id = req.query.osm_way_id?.toString();
  if (!id) return res.status(400).json({ error: 'osm_way_id required' });

  const r = await fetch(
    `${supaUrl}/rest/v1/road_segments?osm_way_id=eq.${encodeURIComponent(id)}` +
    `&select=osm_way_id,name,highway,region,ai_narrative,ai_narrative_grounded_at,ai_narrative_sources` +
    `&limit=1`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
  );

  if (!r.ok) {
    return res.status(500).json({ error: 'lookup failed', status: r.status });
  }
  const rows = (await r.json()) as NarrativeRow[];
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: 'Road not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');

  let parsed: Record<string, unknown> | null = null;
  if (row.ai_narrative) {
    try {
      parsed = JSON.parse(row.ai_narrative);
    } catch {
      parsed = { summary: row.ai_narrative };
    }
  }

  return res.json({
    osm_way_id: row.osm_way_id,
    name: row.name,
    highway: row.highway,
    region: row.region,
    narrative: parsed,
    grounded_at: row.ai_narrative_grounded_at,
    sources: row.ai_narrative_sources ?? [],
  });
}
