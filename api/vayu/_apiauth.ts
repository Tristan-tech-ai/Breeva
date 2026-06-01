import { createHash } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readIpReputation, checkIp, isPrivateOrUnknown, type IpVerdict } from './_ipintel.js';

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

// ── Anti-abuse: IP capture, combined per-IP cap, usage + flag recording ─────
// Soft enforcement: the per-IP cap is the only hard 429; everything else is
// fire-and-forget flagging (surfaced in the dashboard, never blocks).
const RISK_THRESHOLD = (() => { const n = parseInt(process.env.API_RISK_THRESHOLD || '', 10); return Number.isFinite(n) ? n : 80; })();

function clientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  const xr = req.headers['x-real-ip'];
  if (typeof xr === 'string' && xr.trim()) return xr.trim();
  return 'unknown';
}
function clientCountry(req: VercelRequest): string | null {
  const c = req.headers['x-vercel-ip-country'];
  return typeof c === 'string' && c ? c : null;
}

// Combined per-IP daily counter (the "1 usage power per IP" anti-Sybil cap).
async function incrIpDailyCount(ip: string): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const day = new Date().toISOString().slice(0, 10);
  const k = `apiquota:ip:${ip}:${day}`;
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

// Run `fn` at most once per (ip, type, day) via a Redis NX marker (dedup flag spam).
async function flagOncePerDay(ip: string, type: string, fn: () => void): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { fn(); return; } // no Redis → don't suppress (fail-open)
  const day = new Date().toISOString().slice(0, 10);
  const k = `apiabuseflag:${ip}:${type}:${day}`;
  try {
    const resp = await fetch(`${url}/set/${encodeURIComponent(k)}/1/EX/86400/NX`, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await resp.json()) as { result: string | null };
    if (data.result !== null) fn(); // NX set succeeded = first this (ip,type) today
  } catch { /* skip */ }
}

// Service-role RPC POST. Returns the promise so callers can await (Vercel may freeze
// the instance after the response, dropping un-awaited fetches).
function rpcPost(path: string, body: unknown): Promise<void> {
  const { url, key } = supaEnv();
  if (!url || !key) return Promise.resolve();
  return fetch(`${url}/rest/v1/rpc/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(() => {}, () => {});
}
function recordIpCall(keyId: string, userId: string, ip: string, country: string | null, isError: boolean): Promise<void> {
  return rpcPost('bump_ip_usage', { p_key_id: keyId, p_user_id: userId, p_ip: ip, p_country: country, p_is_error: isError });
}
function ensureDeveloperIdentity(userId: string, ip: string, country: string | null, asn: string | null, risk: number): Promise<void> {
  return rpcPost('ensure_developer_identity', { p_user_id: userId, p_ip: ip, p_country: country, p_asn: asn, p_risk: risk });
}
function logFlag(userId: string, keyId: string | null, ip: string, flagType: string, severity: number, detail: unknown): Promise<void> {
  return rpcPost('log_abuse_flag', { p_user_id: userId, p_key_id: keyId, p_ip: ip, p_flag_type: flagType, p_severity: severity, p_detail: detail });
}

// Log VPN/proxy/datacenter/tor/high-risk verdicts (deduped per ip/type/day).
function surfaceIfAnomalous(v: IpVerdict, userId: string, keyId: string, ip: string): void {
  const checks: Array<[boolean, string, number]> = [
    [v.is_tor, 'tor', 3],
    [v.is_vpn, 'vpn', 2],
    [v.is_proxy, 'proxy', 2],
    [v.is_datacenter, 'datacenter', 1],
    [v.risk_score >= RISK_THRESHOLD, 'high_risk_ip', 2],
  ];
  for (const [hit, type, sev] of checks) {
    if (hit) flagOncePerDay(ip, type, () => logFlag(userId, keyId, ip, type, sev, { risk_score: v.risk_score, asn: v.asn, country: v.country }));
  }
}

// Lazy reputation: cache hit → surface now; miss → out-of-band provider check + surface.
function runIpIntel(ip: string, country: string | null, userId: string, keyId: string): void {
  if (isPrivateOrUnknown(ip)) return;
  readIpReputation(ip).then((rep) => {
    if (rep) surfaceIfAnomalous(rep, userId, keyId, ip);
    else checkIp(ip, country).then((v) => surfaceIfAnomalous(v, userId, keyId, ip)).catch(() => {});
  }).catch(() => {});
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
  const ip = clientIp(req);
  const country = clientCountry(req);

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

  // Combined per-IP daily cap — the ONE hard anti-Sybil control (multiple free keys
  // behind one IP share this). Env override `API_IP_DAILY_CAP`, else max(2000, tier cap)
  // so paying tiers are effectively exempt and shared free traffic still has headroom.
  if (ip !== 'unknown') {
    const envCap = parseInt(process.env.API_IP_DAILY_CAP || '', 10);
    const ipCap = Number.isFinite(envCap) ? envCap : Math.max(2000, cap);
    const ipCount = await incrIpDailyCount(ip);
    if (ipCount !== null && ipCount > ipCap) {
      flagOncePerDay(ip, 'per_ip_cap', () => logFlag(k.user_id, k.id, ip, 'per_ip_cap', 3, { count: ipCount, cap: ipCap }));
      await recordCall(k.id, k.user_id, endpoint, true);
      res.status(429).json({ error: 'ip_rate_limit_exceeded', detail: `This IP has reached the combined daily request limit (${ipCap}).` });
      return { ok: false };
    }
  }

  // Persist usage + per-IP rollup + identity in parallel (one round-trip; reliable on
  // serverless). IP reputation is best-effort + cached, so it stays truly async.
  await Promise.all([
    recordCall(k.id, k.user_id, endpoint, false),
    recordIpCall(k.id, k.user_id, ip, country, false),
    ensureDeveloperIdentity(k.user_id, ip, country, null, 0),
  ]);
  runIpIntel(ip, country, k.user_id, k.id);
  return { ok: true, userId: k.user_id, tier: k.tier, keyId: k.id };
}
