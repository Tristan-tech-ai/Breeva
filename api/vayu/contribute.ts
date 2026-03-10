import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Crowdsource Contribution Endpoint
 * ERD Section 6.1 — Passive Data Collection (anonymous traces)
 *
 * POST body: PassiveTrace fields
 * Rate limit: 1 per IP per osm_way_id per 10 minutes (via Upstash Redis)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const VALID_VEHICLE_TYPES = [
  'pedestrian', 'cyclist', 'motorcycle_open', 'motorcycle_full',
  'car_window_open', 'car_ac_recirculate', 'car_ac_fresh', 'public_transport',
];

interface ContributeRequest {
  session_id: string;
  osm_way_id?: number;
  speed_kmh?: number;
  vehicle_type: string;
  is_off_road?: boolean;
  off_road_geohash?: string;
}

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Rate limit check via Upstash Redis REST API */
async function checkRateLimit(ip: string, wayKey: string): Promise<boolean> {
  if (!REDIS_URL || !REDIS_TOKEN) return true; // skip if no Redis

  const key = `vayu:rl:${ip}:${wayKey}`;
  try {
    const resp = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/1/EX/600/NX`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    });
    const data = await resp.json() as { result: string | null };
    // NX returns null if key already exists → rate limited
    return data.result !== null;
  } catch {
    return true; // allow on Redis failure
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as ContributeRequest;

  // --- Validation ---
  if (!body.session_id || !isValidUUID(body.session_id)) {
    return res.status(400).json({ error: 'Valid session_id (UUID) required' });
  }
  if (!body.vehicle_type || !VALID_VEHICLE_TYPES.includes(body.vehicle_type)) {
    return res.status(400).json({ error: `vehicle_type must be one of: ${VALID_VEHICLE_TYPES.join(', ')}` });
  }
  if (!body.is_off_road && !body.osm_way_id) {
    return res.status(400).json({ error: 'osm_way_id required when not off-road' });
  }
  if (body.is_off_road && !body.off_road_geohash) {
    return res.status(400).json({ error: 'off_road_geohash required when is_off_road=true' });
  }
  if (body.speed_kmh !== undefined && (body.speed_kmh < 0 || body.speed_kmh > 200)) {
    return res.status(400).json({ error: 'speed_kmh must be 0-200' });
  }
  if (body.off_road_geohash && !/^[0-9a-z]{1,15}$/i.test(body.off_road_geohash)) {
    return res.status(400).json({ error: 'Invalid off_road_geohash format' });
  }

  // --- Rate Limiting ---
  const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  const wayKey = body.is_off_road ? `offroad:${body.off_road_geohash}` : `way:${body.osm_way_id}`;

  const allowed = await checkRateLimit(clientIP, wayKey);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limit: 1 contribution per road segment per 10 minutes' });
  }

  // --- Insert into Supabase ---
  try {
    const row: Record<string, unknown> = {
      session_id: body.session_id,
      vehicle_type: body.vehicle_type,
      is_off_road: body.is_off_road || false,
    };
    if (body.osm_way_id) row.osm_way_id = body.osm_way_id;
    if (body.speed_kmh !== undefined) row.speed_kmh = body.speed_kmh;
    if (body.off_road_geohash) row.off_road_geohash = body.off_road_geohash;

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/vayu_contributions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Supabase insert error:', resp.status, text);
      return res.status(502).json({ error: 'Failed to store contribution' });
    }

    return res.status(201).json({ ok: true, message: 'Contribution recorded' });
  } catch (error) {
    console.error('VAYU contribute error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
