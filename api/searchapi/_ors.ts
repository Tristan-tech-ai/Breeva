/**
 * OpenRouteService requests built server-side, so the ORS key never reaches the browser.
 * Only whitelisted operations and fields are forwarded; the key is added by the caller after validation.
 */

const ORS_BASE = 'https://api.openrouteservice.org';

export const ORS_PROFILES = new Set(['foot-walking', 'cycling-regular', 'cycling-electric', 'driving-car']);
const PREFERENCES = new Set(['fastest', 'shortest', 'recommended']);
const AVOID = new Set(['highways', 'tollways', 'ferries', 'fords', 'steps']);
const MAX_POINTS = 12;

export interface OrsUpstream {
  /** URL without the api key. */
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  /** Seconds the response may be cached server-side; 0 = never. */
  cacheTtlSec: number;
}

export type OrsBuild = { ok: true; upstream: OrsUpstream } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): OrsBuild => ({ ok: false, status, error });

function str(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  const s = str(v);
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const isLat = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90;
const isLng = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180;

function directions(query: Record<string, unknown>, body: unknown): OrsBuild {
  const profile = str(query.profile) ?? 'foot-walking';
  if (!ORS_PROFILES.has(profile)) return fail(400, 'unsupported profile');
  if (!body || typeof body !== 'object') return fail(400, 'missing body');
  const b = body as Record<string, unknown>;
  const coords = b.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_POINTS) return fail(400, 'coordinates must hold 2 to 12 points');
  const clean: [number, number][] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length !== 2 || !isLng(c[0]) || !isLat(c[1])) return fail(400, 'invalid coordinate');
    clean.push([c[0], c[1]]);
  }
  const out: Record<string, unknown> = { coordinates: clean, instructions: true, units: 'm' };
  if (b.preference !== undefined) {
    if (typeof b.preference !== 'string' || !PREFERENCES.has(b.preference)) return fail(400, 'invalid preference');
    out.preference = b.preference;
  }
  const alt = b.alternative_routes as Record<string, unknown> | undefined;
  if (alt !== undefined) {
    if (!alt || typeof alt !== 'object') return fail(400, 'invalid alternative_routes');
    const a: Record<string, number> = {};
    const share = alt.share_factor, count = alt.target_count, weight = alt.weight_factor;
    if (share !== undefined) { if (typeof share !== 'number' || share < 0.01 || share > 1) return fail(400, 'invalid share_factor'); a.share_factor = share; }
    if (count !== undefined) { if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 3) return fail(400, 'invalid target_count'); a.target_count = count; }
    if (weight !== undefined) { if (typeof weight !== 'number' || weight < 1 || weight > 5) return fail(400, 'invalid weight_factor'); a.weight_factor = weight; }
    out.alternative_routes = a;
  }
  const opts = b.options as Record<string, unknown> | undefined;
  if (opts !== undefined) {
    const av = opts && typeof opts === 'object' ? opts.avoid_features : undefined;
    if (!Array.isArray(av) || !av.every((x) => typeof x === 'string' && AVOID.has(x))) return fail(400, 'invalid avoid_features');
    out.options = { avoid_features: av };
  }
  return { ok: true, upstream: { url: `${ORS_BASE}/v2/directions/${profile}/geojson`, method: 'POST', body: JSON.stringify(out), cacheTtlSec: 0 } };
}

function geocode(query: Record<string, unknown>): OrsBuild {
  const text = str(query.text)?.trim();
  if (!text || text.length > 200) return fail(400, 'text must be 1 to 200 characters');
  const size = num(query.size) ?? 5;
  if (!Number.isInteger(size) || size < 1 || size > 10) return fail(400, 'invalid size');
  const p = new URLSearchParams({ text, size: String(size), layers: 'address,venue,street' });
  const lat = num(query.lat), lon = num(query.lon);
  if (lat !== undefined || lon !== undefined) {
    if (!isLat(lat) || !isLng(lon)) return fail(400, 'invalid focus point');
    p.set('focus.point.lat', String(lat));
    p.set('focus.point.lon', String(lon));
  }
  return { ok: true, upstream: { url: `${ORS_BASE}/geocode/search?${p}`, method: 'GET', cacheTtlSec: 86_400 } };
}

function reverse(query: Record<string, unknown>): OrsBuild {
  const lat = num(query.lat), lon = num(query.lon);
  if (!isLat(lat) || !isLng(lon)) return fail(400, 'invalid point');
  // Rounded to about 11 m so nearby taps share one cache entry.
  const p = new URLSearchParams({ 'point.lat': lat.toFixed(4), 'point.lon': lon.toFixed(4), size: '1' });
  return { ok: true, upstream: { url: `${ORS_BASE}/geocode/reverse?${p}`, method: 'GET', cacheTtlSec: 604_800 } };
}

export function buildOrsRequest(method: string, query: Record<string, unknown>, body: unknown): OrsBuild {
  const op = str(query.op);
  if (op === 'directions') return method === 'POST' ? directions(query, body) : fail(405, 'directions needs POST');
  if (op === 'geocode') return method === 'GET' ? geocode(query) : fail(405, 'geocode needs GET');
  if (op === 'reverse') return method === 'GET' ? reverse(query) : fail(405, 'reverse needs GET');
  return fail(400, 'unknown op');
}

/** Adds the key: query parameter for GET (ORS geocoding), Authorization header for POST (ORS directions). */
export function withOrsKey(u: OrsUpstream, key: string): { url: string; init: RequestInit } {
  if (u.method === 'GET') {
    const url = new URL(u.url);
    url.searchParams.set('api_key', key);
    return { url: url.toString(), init: { method: 'GET', headers: { Accept: 'application/json' } } };
  }
  return {
    url: u.url,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: key }, body: u.body },
  };
}
