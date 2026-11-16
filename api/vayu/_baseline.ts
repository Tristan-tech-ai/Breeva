/**
 * Open-Meteo background field shared by road-aqi and route-score.
 *
 * Both endpoints used to keep their own copy. route-score's copy did not fetch wind direction, but wrote the same
 * Redis key road-aqi reads; road-aqi then interpolated `undefined`, got NaN and fell back to a wind from 0 degrees,
 * so the dispersion plume pointed the wrong way whenever route-score had filled the cache first. Wind direction was
 * also averaged as a plain number, which turns 350 and 10 degrees into 180. This module fetches one shape, caches it
 * under a versioned key, rejects incomplete cache entries and averages directions as vectors.
 */

export interface BaselineData {
  pm25: number; pm10: number; no2: number;
  co: number; o3: number; wind_speed: number;
  /** Direction the wind blows FROM, degrees clockwise from north (Open-Meteo wind_direction_10m). */
  wind_direction: number;
}

export interface BaselineCorners { center: BaselineData; nw: BaselineData; ne: BaselineData; sw: BaselineData; se: BaselineData }

export interface BaselineDeps {
  redisGet: (key: string) => Promise<string | null>;
  redisSetEx: (key: string, ttlSec: number, value: string) => Promise<void>;
  ttlSec: number;
  fetchImpl?: typeof fetch;
}

const SCALARS = ['pm25', 'pm10', 'no2', 'co', 'o3', 'wind_speed'] as const;
const FIELDS = [...SCALARS, 'wind_direction'] as const;
const CORNERS = ['center', 'nw', 'ne', 'sw', 'se'] as const;
const OFFSET = 0.1;

/** v2: entries written before 16 Nov 2026 (`vayu:bl:`) may lack wind_direction and are never read. */
export function baselineCacheKey(qLat: number, qLon: number, forecastHour: number): string {
  return `vayu:bl2:${qLat.toFixed(2)}:${qLon.toFixed(2)}:fh${forecastHour}`;
}

export function isCompleteBaseline(v: unknown): v is BaselineData {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return FIELDS.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}

export function parseCachedCorners(raw: string | null): BaselineCorners | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return CORNERS.every((c) => isCompleteBaseline(o[c])) ? (o as unknown as BaselineCorners) : null;
  } catch {
    return null;
  }
}

/** Weighted mean of directions in degrees, computed on unit vectors. Returns 0..360. */
export function meanDirection(dirs: readonly number[], weights: readonly number[]): number {
  let x = 0, y = 0;
  dirs.forEach((d, i) => {
    const r = (d * Math.PI) / 180;
    x += Math.sin(r) * weights[i];
    y += Math.cos(r) * weights[i];
  });
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return dirs[0] ?? 0;
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function buildInterpolator(south: number, west: number, north: number, east: number, g: BaselineCorners) {
  const { center, nw, ne, sw, se } = g;
  return (lat: number, lon: number): BaselineData => {
    const latSpan = north - south || 0.001;
    const lonSpan = east - west || 0.001;
    const ty = Math.max(0, Math.min(1, (lat - south) / latSpan));
    const tx = Math.max(0, Math.min(1, (lon - west) / lonSpan));
    // Bilinear between the four corners (weight 0.6), plus the centre (weight 0.4).
    const w = { nw: (1 - tx) * ty * 0.6, ne: tx * ty * 0.6, sw: (1 - tx) * (1 - ty) * 0.6, se: tx * (1 - ty) * 0.6, center: 0.4 };
    const pts = [nw, ne, sw, se, center];
    const ws = [w.nw, w.ne, w.sw, w.se, w.center];
    const out = {} as BaselineData;
    for (const k of SCALARS) out[k] = pts.reduce((s, p, i) => s + p[k] * ws[i], 0);
    out.wind_direction = meanDirection(pts.map((p) => p.wind_direction), ws);
    return out;
  };
}

type Row = Record<string, unknown>;
const pick = (o: unknown, k: string): number | undefined => {
  const v = (o as Row | undefined)?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const pickHourly = (o: unknown, k: string, idx: number): number | undefined => {
  const arr = ((o as Row | undefined)?.hourly as Row | undefined)?.[k];
  const v = Array.isArray(arr) ? arr[idx] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** Fallbacks used when Open-Meteo leaves a field empty (kept from the previous implementation). */
const FALLBACK: BaselineData = { pm25: 15, pm10: 25, no2: 10, co: 200, o3: 30, wind_speed: 2.0, wind_direction: 0 };

export async function fetchBaselineBatch(lats: number[], lons: number[], forecastHour = 0, fetchImpl: typeof fetch = fetch): Promise<BaselineData[]> {
  const latStr = lats.map((l) => l.toFixed(4)).join(',');
  const lonStr = lons.map((l) => l.toFixed(4)).join(',');
  const n = lats.length;
  const aqVars = 'pm2_5,pm10,nitrogen_dioxide,carbon_monoxide,ozone';
  const wxVars = 'wind_speed_10m,wind_direction_10m';
  const current = forecastHour <= 0;
  const when = current ? `current=` : `forecast_hours=${forecastHour + 1}&hourly=`;
  const [aqResp, wxResp] = await Promise.all([
    fetchImpl(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latStr}&longitude=${lonStr}&${when}${aqVars}&timezone=auto`),
    fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}&${when}${wxVars}&timezone=auto`),
  ]);
  const aqJson = aqResp.ok ? await aqResp.json() : null;
  const wxJson = wxResp.ok ? await wxResp.json() : null;
  // A multi-point request returns an array; a single point returns one object.
  const rows = (j: unknown): unknown[] => (n === 1 ? [j] : Array.isArray(j) ? j : []);
  const aq = rows(aqJson), wx = rows(wxJson);
  const get = (o: unknown, k: string) => (current ? pick((o as Row | undefined)?.current, k) : pickHourly(o, k, forecastHour));
  return lats.map((_, i) => ({
    pm25: get(aq[i], 'pm2_5') ?? FALLBACK.pm25,
    pm10: get(aq[i], 'pm10') ?? FALLBACK.pm10,
    no2: get(aq[i], 'nitrogen_dioxide') ?? FALLBACK.no2,
    co: get(aq[i], 'carbon_monoxide') ?? FALLBACK.co,
    o3: get(aq[i], 'ozone') ?? FALLBACK.o3,
    wind_speed: get(wx[i], 'wind_speed_10m') ?? FALLBACK.wind_speed,
    wind_direction: get(wx[i], 'wind_direction_10m') ?? FALLBACK.wind_direction,
  }));
}

/** Five fixed points (centre + corners) on a 0.1 degree grid, cached; returns the centre and an interpolator. */
export async function fetchBaselineGrid(south: number, west: number, north: number, east: number, forecastHour: number, deps: BaselineDeps) {
  // Centre quantised to 0.1 degree (about 11 km) so zoom changes and padding keep the same grid.
  const qLat = Math.round(((south + north) / 2) * 10) / 10;
  const qLon = Math.round(((west + east) / 2) * 10) / 10;
  const gS = qLat - OFFSET, gN = qLat + OFFSET, gW = qLon - OFFSET, gE = qLon + OFFSET;
  const key = baselineCacheKey(qLat, qLon, forecastHour);

  let corners = parseCachedCorners(await deps.redisGet(key));
  if (!corners) {
    const [center, nw, ne, sw, se] = await fetchBaselineBatch([qLat, gN, gN, gS, gS], [qLon, gW, gE, gW, gE], forecastHour, deps.fetchImpl);
    corners = { center, nw, ne, sw, se };
    await deps.redisSetEx(key, deps.ttlSec, JSON.stringify(corners));
  }
  const bounds = { south: gS, west: gW, north: gN, east: gE };
  return { center: corners.center, interpolate: buildInterpolator(gS, gW, gN, gE, corners), corners, bounds };
}
