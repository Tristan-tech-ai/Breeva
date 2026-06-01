import { createHash } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Shared Developer-API gate. Underscore prefix = inlined util, NOT a Vercel function
// (keeps us within the 12-function Hobby cap). Used by the VAYU endpoints when reached
// via /api/v1/* (rewritten to ?v1=1). The app's own /api/vayu/* calls never hit this.

// Daily request caps per tier.
const TIER_CAPS: Record<string, number> = { free: 1000, pro: 50000, enterprise: 100_000_000 };

function supaEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function extractKey(req: VercelRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  return null;
}

async function lookupKey(hash: string): Promise<{ id: string; user_id: string; tier: string } | null> {
  const { url, key } = supaEnv();
  if (!url || !key) return null;
  try {
    const resp = await fetch(
      `${url}/rest/v1/api_keys?key_hash=eq.${hash}&revoked_at=is.null&select=id,user_id,tier&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ id: string; user_id: string; tier: string }>;
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}

// Atomic per-key daily counter in Upstash. Returns the new count, or null if Redis is
// unavailable (fail-open: validate the key, skip the cap rather than break the API).
async function incrDailyCount(hash: string): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const day = new Date().toISOString().slice(0, 10);
  const k = `apiquota:${hash}:${day}`;
  try {
    const resp = await fetch(`${url}/incr/${encodeURIComponent(k)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    const n = parseInt((await resp.json()).result, 10);
    if (n === 1) {
      fetch(`${url}/expire/${encodeURIComponent(k)}/172800`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

// Record usage (atomic +1) + bump last_used_at via SECURITY DEFINER RPC (service_role only).
async function recordCall(keyId: string, userId: string, endpoint: string, isError: boolean): Promise<void> {
  const { url, key } = supaEnv();
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/rpc/bump_api_usage`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key_id: keyId, p_user_id: userId, p_endpoint: endpoint, p_is_error: isError }),
    });
  } catch { /* usage logging is best-effort */ }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,x-api-key');
}

export interface ApiGateResult { ok: boolean; userId?: string; tier?: string; keyId?: string; }

/**
 * Gate a public-API request. Returns { ok:true, ... } to proceed, or writes the
 * appropriate response (204 preflight / 401 / 429) and returns { ok:false } — the
 * caller must `return` immediately when `!ok`.
 */
export async function requireApiKey(req: VercelRequest, res: VercelResponse, endpoint: string): Promise<ApiGateResult> {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return { ok: false }; }

  const raw = extractKey(req);
  if (!raw) {
    res.status(401).json({ error: 'missing_api_key', detail: 'Provide your key via "Authorization: Bearer <key>" or the "x-api-key" header.' });
    return { ok: false };
  }
  const hash = createHash('sha256').update(raw).digest('hex');
  const k = await lookupKey(hash);
  if (!k) {
    res.status(401).json({ error: 'invalid_api_key', detail: 'Key not found or revoked.' });
    return { ok: false };
  }
  const cap = TIER_CAPS[k.tier] ?? TIER_CAPS.free;
  const count = await incrDailyCount(hash);
  if (count !== null) {
    res.setHeader('X-RateLimit-Limit', String(cap));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, cap - count)));
    if (count > cap) {
      await recordCall(k.id, k.user_id, endpoint, true);
      res.status(429).json({ error: 'rate_limit_exceeded', detail: `Daily limit of ${cap} requests for the '${k.tier}' tier reached.` });
      return { ok: false };
    }
  }
  await recordCall(k.id, k.user_id, endpoint, false);
  return { ok: true, userId: k.user_id, tier: k.tier, keyId: k.id };
}
