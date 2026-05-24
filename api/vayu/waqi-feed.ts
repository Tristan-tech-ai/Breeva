import type { VercelRequest, VercelResponse } from '@vercel/node';

// 2026-05-24 SECURITY FIX: server-side WAQI feed proxy.
// Frontend hits /api/vayu/waqi-feed?uid=N for per-station data.
// Mirrors token-rotation pattern of waqi-stations.ts.

const WAQI_BASE = 'https://api.waqi.info';

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
  return null;
}

function markFailed(token: string, seconds = 60) {
  _cooldownUntil.set(token, Date.now() + seconds * 1000);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const uidRaw = req.query.uid;
  const uid = Number(Array.isArray(uidRaw) ? uidRaw[0] : uidRaw);
  if (!Number.isFinite(uid) || uid <= 0) {
    return res.status(400).json({ error: 'uid query param required: positive integer' });
  }

  let attempts = 0;
  while (attempts < 3) {
    const token = pickToken();
    if (!token) {
      return res.status(503).json({ error: 'No healthy WAQI tokens available' });
    }
    attempts += 1;

    try {
      const url = `${WAQI_BASE}/feed/@${uid}/?token=${encodeURIComponent(token)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'breeva-waqi-proxy/1.0' } });
      const json = await r.json();
      if (json.status === 'ok') {
        // 10-minute cache (matches frontend FEED_TTL)
        res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=600, stale-while-revalidate=1200');
        return res.status(200).json({ status: 'ok', data: json.data });
      }
      markFailed(token);
    } catch (err) {
      markFailed(token);
      console.error(`waqi-feed: fetch failed for token ending ${token.slice(-4)}: ${err}`);
    }
  }

  return res.status(502).json({ error: 'WAQI upstream failed after token rotation' });
}
