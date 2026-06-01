import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';

// ─── Multi-key pool ─────────────────────────────────────────
// SearchAPI credits are a hard, non-resetting cap per key, so keys are drained
// sequentially: once one is exhausted (401 invalid / 429 out-of-credits) we
// advance to the next and never look back. Keys come from SEARCHAPI_KEYS
// (comma-separated) with a fallback to the legacy single SEARCHAPI_KEY — never
// hardcoded in source.
const SEARCHAPI_KEYS: string[] = (() => {
  const multi = (process.env.SEARCHAPI_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  const single = (process.env.SEARCHAPI_KEY || '').trim();
  return single ? [single] : [];
})();

// Redis-persisted index of the first still-live key, so exhausted keys aren't
// re-probed on every request (each dead probe is a wasted round-trip). Optional:
// if Redis is unavailable we just start at 0 and rotate in-request.
const POINTER_KEY = 'searchapi:key_index';

// Allowed engines to prevent abuse
const ALLOWED_ENGINES = new Set([
  'google_maps',
  'google_maps_place',
  'google_maps_reviews',
  'google_maps_photos',
]);

// ─── Redis pointer helpers (Upstash REST) ───────────────────
async function redisGetInt(key: string): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const n = parseInt(json.result, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function redisSetInt(key: string, val: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${val}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* non-fatal — pointer is an optimization, not correctness */
  }
}

// ─── Response cache (Upstash) ───────────────────────────────
// SearchAPI place-details/search results barely change but are slow (1.5–3s) AND burn
// finite credits. Cache the full JSON server-side so repeat / popular POIs are instant
// and don't consume a credit. Command form = large payloads ride the POST body, not the URL.
async function redisCmd(args: Array<string | number>): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!resp.ok) return null;
    return (await resp.json()).result ?? null;
  } catch {
    return null;
  }
}
async function cacheGet(key: string): Promise<unknown | null> {
  const v = await redisCmd(['GET', key]);
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}
async function cacheSet(key: string, data: unknown, ttlSec: number): Promise<void> {
  try { await redisCmd(['SET', key, JSON.stringify(data), 'EX', ttlSec]); } catch { /* best-effort */ }
}

// 401 = invalid/disabled key · 429 = out of credits (or rate-limited).
// Either way the key is unusable right now → rotate to the next one.
function isKeyExhausted(status: number): boolean {
  return status === 401 || status === 429;
}

// Bounded fetch so a slow upstream can't hang the function across N retries.
async function fetchWithTimeout(target: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(target, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SEARCHAPI_KEYS.length) {
    return res.status(500).json({ error: 'SearchAPI key not configured' });
  }

  const { engine, ...params } = req.query;

  if (!engine || typeof engine !== 'string' || !ALLOWED_ENGINES.has(engine)) {
    return res.status(400).json({ error: 'Invalid or missing engine parameter' });
  }

  // Build the upstream URL once (api_key is injected per-attempt below).
  const baseUrl = new URL(SEARCHAPI_BASE);
  baseUrl.searchParams.set('engine', engine);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && key !== 'api_key') {
      baseUrl.searchParams.set(key, value);
    }
  }

  // ── Serve from cache if we have a recent identical response (skips the slow upstream + a credit) ──
  const cacheKey = `sapi:${engine}:${createHash('sha1').update(baseUrl.search).digest('hex')}`;
  const ttlSec = engine === 'google_maps_place' ? 604_800 : 86_400; // details 7d · search/photos/reviews 1d
  const cached = await cacheGet(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-SearchAPI-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  // Start at the first key not yet known-dead.
  let startIdx = (await redisGetInt(POINTER_KEY)) ?? 0;
  if (!Number.isInteger(startIdx) || startIdx < 0 || startIdx >= SEARCHAPI_KEYS.length) {
    startIdx = 0;
  }

  let lastStatus = 502;
  let lastDetails = '';

  for (let i = startIdx; i < SEARCHAPI_KEYS.length; i++) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set('api_key', SEARCHAPI_KEYS[i]);

    let response: Response;
    try {
      response = await fetchWithTimeout(url.toString(), 12_000);
    } catch {
      // Network error / timeout — could be transient; try the next key but
      // don't burn the pointer on it.
      lastStatus = 504;
      lastDetails = 'upstream timeout';
      continue;
    }

    if (response.ok) {
      const data = await response.json();
      // Remember the first live key so dead ones ahead of it are skipped next time.
      if (i !== startIdx) await redisSetInt(POINTER_KEY, i);
      await cacheSet(cacheKey, data, ttlSec); // populate cache so the next open is instant
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.setHeader('X-SearchAPI-Key-Index', String(i));
      res.setHeader('X-SearchAPI-Cache', 'MISS');
      return res.status(200).json(data);
    }

    const text = (await response.text()).slice(0, 300);

    if (isKeyExhausted(response.status)) {
      // This key is dead — advance the pointer past it permanently and rotate.
      await redisSetInt(POINTER_KEY, Math.min(i + 1, SEARCHAPI_KEYS.length - 1));
      lastStatus = response.status;
      lastDetails = text;
      continue;
    }

    // A non-key error (bad params, upstream 5xx): not solved by rotating — surface it.
    return res
      .status(response.status)
      .json({ error: `SearchAPI error: ${response.status}`, details: text });
  }

  // Every key from the pointer onward is exhausted.
  console.error('SearchAPI: all keys exhausted', { tried: SEARCHAPI_KEYS.length - startIdx, lastStatus });
  return res.status(503).json({
    error: 'All SearchAPI keys exhausted',
    last_status: lastStatus,
    details: lastDetails,
  });
}
