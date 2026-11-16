/**
 * Request guards shared by the public endpoints: a per-IP rate limit and the cron secret check.
 * Underscore module: inlined into each function bundle, not a Vercel function of its own.
 */
import { createHash, timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type Env = Record<string, string | undefined>;

export function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
  if (first) return first;
  const xr = req.headers['x-real-ip'];
  return typeof xr === 'string' && xr.trim() ? xr.trim() : 'unknown';
}

let warnedNoRedis = false;

/**
 * Fixed one-minute window per (bucket, IP) in Upstash. Returns true to proceed; on excess writes 429 and returns false.
 * Fails open (proceeds) when Redis is missing or errors, and logs it, so an outage of the limiter never takes the map down.
 */
export async function rateLimit(
  req: VercelRequest, res: VercelResponse, bucket: string, perMinute: number,
  env: Env = process.env, fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<boolean> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedNoRedis) { console.warn('[ratelimit] fail-open: Redis not configured'); warnedNoRedis = true; }
    return true;
  }
  const window = Math.floor(now / 60_000);
  const key = `rl:${bucket}:${clientIp(req)}:${window}`;
  try {
    const r = await fetchImpl(`${url}/incr/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`incr ${r.status}`);
    const n = Number((await r.json()).result);
    if (n === 1) await fetchImpl(`${url}/expire/${encodeURIComponent(key)}/120`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    res.setHeader('X-RateLimit-Limit', String(perMinute));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, perMinute - n)));
    if (n > perMinute) {
      res.setHeader('Retry-After', String(60 - Math.floor((now / 1000) % 60)));
      res.status(429).json({ error: 'rate_limited', detail: `At most ${perMinute} requests per minute from one address.` });
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[ratelimit] fail-open:', e instanceof Error ? e.message : e);
    return true;
  }
}

/** Per-endpoint limits per IP per minute. Generous: a school behind one NAT address must still work. */
export const LIMITS = {
  aqi: 300, roadAqi: 1200, routeScore: 60, exposure: 120, contribute: 20, roadForecast: 300, waqi: 300, search: 120,
} as const;

/**
 * 'absent' = no cron header (an ordinary request); 'valid' = header matches BREEVA_CRON_SECRET;
 * 'invalid' = header present but wrong, or the server has no secret configured (then nothing can be 'valid').
 * Cron-only side effects must require 'valid'; a missing header never grants them.
 */
export function cronStatus(req: VercelRequest, env: Env = process.env): 'absent' | 'valid' | 'invalid' {
  const raw = req.headers['x-breeva-cron-secret'];
  const got = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!got) return 'absent';
  const want = env.BREEVA_CRON_SECRET?.trim();
  if (!want) return 'invalid';
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b) ? 'valid' : 'invalid';
}
