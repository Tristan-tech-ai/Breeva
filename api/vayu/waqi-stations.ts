import type { VercelRequest, VercelResponse } from '@vercel/node';

// 2026-05-24 SECURITY FIX: server-side WAQI proxy.
// Replaces direct browser → WAQI calls (which leaked VITE_WAQI_TOKEN publicly via bundle).
// Frontend now hits /api/vayu/waqi-stations?bbox=S,W,N,E and Vercel proxies with server-side token.
//
// Multi-token rotator: parses WAQI_TOKENS csv env, falls back to single WAQI_TOKEN.
// Per-token 60s cooldown on failure (parity with snapshot_stations.py WAQIKeyRotator).

const WAQI_BASE = 'https://api.waqi.info';

// Module-level rotator state (persists across same-instance invocations).
let _tokens: string[] = [];
let _idx = 0;
const _cooldownUntil: Map<string, number> = new Map();

function loadTokens(): string[] {
  if (_tokens.length > 0) return _tokens;
  const csv = (process.env.WAQI_TOKENS || '').trim();
  if (csv) {
    _tokens = csv.split(',').map((t) => t.trim()).filter(Boolean);
  } else {
    const single = (process.env.WAQI_TOKEN || '').trim();
    if (single) _tokens = [single];
  }
  return _tokens;
}

function pickToken(): string | null {
  const tokens = loadTokens();
  if (tokens.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[_idx % tokens.length];
    _idx += 1;
    const cooldown = _cooldownUntil.get(tok) ?? 0;
    if (cooldown <= now) return tok;
  }
  return null; // all tokens on cooldown
}

function markFailed(token: string, seconds = 60) {
  _cooldownUntil.set(token, Date.now() + seconds * 1000);
}

function parseBbox(input: string | string[] | undefined): [number, number, number, number] | null {
  if (typeof input !== 'string') return null;
  const parts = input.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const bbox = parseBbox(req.query.bbox);
  if (!bbox) {
    return res.status(400).json({ error: 'bbox query param required: S,W,N,E (e.g. -6.5,106.4,-5.95,107.15)' });
  }
  const [s, w, n, e] = bbox;

  // Try up to 3 tokens before giving up
  let attempts = 0;
  while (attempts < 3) {
    const token = pickToken();
    if (!token) {
      return res.status(503).json({ error: 'No healthy WAQI tokens available' });
    }
    attempts += 1;

    try {
      const url = `${WAQI_BASE}/v2/map/bounds?latlng=${s},${w},${n},${e}&networks=all&token=${encodeURIComponent(token)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'breeva-waqi-proxy/1.0' } });
      const json = await r.json();
      if (json.status === 'ok') {
        // 5-minute cache (matches frontend BOUNDS_TTL)
        res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=300, stale-while-revalidate=600');
        return res.status(200).json({ status: 'ok', data: json.data });
      }
      // Non-ok: mark token failed, try next
      markFailed(token);
    } catch (err) {
      markFailed(token);
      console.error(`waqi-stations: fetch failed for token ending ${token.slice(-4)}: ${err}`);
    }
  }

  return res.status(502).json({ error: 'WAQI upstream failed after token rotation' });
}
