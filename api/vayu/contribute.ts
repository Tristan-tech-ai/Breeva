import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * VAYU Contribution Endpoint (consolidated — Vercel Hobby 12-function cap).
 * Two flows, dispatched by the request body:
 *   1. Manual contribution submit (Bearer auth, body.type ∈ contribution types) —
 *      server-authoritative: persists to air_quality_reports / place_contributions,
 *      Gemini sanity-check, claim_reward + record_quest_progress + contribution_count.
 *   2. Passive VAYU trace (anonymous session_id) — ERD 6.1, rate-limited, REST insert
 *      into vayu_contributions. (UNCHANGED behaviour.)
 */

export const config = { maxDuration: 15 };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const VALID_VEHICLE_TYPES = [
  'pedestrian', 'cyclist', 'motorcycle_open', 'motorcycle_full',
  'car_window_open', 'car_ac_recirculate', 'car_ac_fresh', 'public_transport',
];

const PLACE_TYPES = ['missing_place', 'eco_merchant', 'green_space'] as const;
const CONTRIB_TYPES = ['hazard', ...PLACE_TYPES] as const;
type Status = 'pending' | 'approved' | 'rejected';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body || {}) as Record<string, unknown>;
  // Discriminate the two flows: a manual submit carries a contribution `type`.
  if (typeof body.type === 'string' && (CONTRIB_TYPES as readonly string[]).includes(body.type)) {
    return handleContributionSubmit(req, res);
  }
  return handlePassiveTrace(req, res, body as unknown as ContributeRequest);
}

// ─── Flow 1: manual contribution submit (server-authoritative) ────────────────
type ContributionType = (typeof CONTRIB_TYPES)[number];
interface SubmitBody {
  type: ContributionType; user_id: string;
  name?: string; category?: string; description?: string;
  lat?: number; lng?: number; aqi_rating?: number; photo_url?: string;
}

async function handleContributionSubmit(req: VercelRequest, res: VercelResponse) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase service role' });
  }
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase auth type omits getUser in some type resolutions (same cast as api/walks/complete.ts)
    const { data: { user: authUser }, error: authError } = await (userClient.auth as any).getUser();
    if (authError || !authUser) return res.status(401).json({ error: 'Invalid or expired token' });

    const body = (req.body || {}) as SubmitBody;
    const { type, user_id } = body;
    if (!type || !(CONTRIB_TYPES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Invalid contribution type' });
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (user_id !== authUser.id) return res.status(403).json({ error: 'Forbidden: user mismatch' });

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const category = typeof body.category === 'string' ? body.category.trim().slice(0, 60) : null;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 600) : null;
    const photo_url = typeof body.photo_url === 'string' && body.photo_url.startsWith('http') ? body.photo_url : null;
    const lat = Number.isFinite(body.lat) ? Number(body.lat) : null;
    const lng = Number.isFinite(body.lng) ? Number(body.lng) : null;
    const hasCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    if (type === 'hazard') {
      if (!hasCoords) return res.status(400).json({ error: 'Location required for an air-quality report' });
    } else if (name.length < 3) {
      return res.status(400).json({ error: 'Name must be at least 3 characters' });
    }
    let aqiRating = Number.isFinite(body.aqi_rating) ? Math.round(Number(body.aqi_rating)) : 4;
    aqiRating = Math.max(1, Math.min(5, aqiRating));

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let region_code: string | null = null;
    if (hasCoords) {
      try {
        const { data } = await service.rpc('breeva_nearest_region', { p_lat: lat, p_lng: lng });
        if (typeof data === 'string') region_code = data;
      } catch { /* non-fatal */ }
    }

    const ai = await sanityCheckContribution({ type, name, category, description, lat, lng, aqi_rating: type === 'hazard' ? aqiRating : undefined });
    const status: Status = ai.status;
    const validated_at = status === 'pending' ? null : new Date().toISOString();

    let contribution_id: string;
    if (type === 'hazard') {
      const { data, error } = await service.from('air_quality_reports').insert({
        user_id, lat, lng, aqi_rating: aqiRating,
        description: name ? (description ? `${name} — ${description}` : name) : (description || 'Laporan kualitas udara'),
        ...(photo_url ? { photo_url } : {}),
        status, ai_confidence: ai.confidence, ai_notes: ai.notes, validated_at, source: 'report',
      }).select('id').single();
      if (error || !data) { console.error('[contribute/submit] aqr insert error:', error); return res.status(500).json({ error: 'Failed to save contribution' }); }
      contribution_id = data.id;
    } else {
      const { data, error } = await service.from('place_contributions').insert({
        user_id, type, name, category, description, lat, lng,
        ...(photo_url ? { photo_url } : {}),
        status, region_code, ai_confidence: ai.confidence, ai_notes: ai.notes, validated_at,
      }).select('id').single();
      if (error || !data) { console.error('[contribute/submit] place insert error:', error); return res.status(500).json({ error: 'Failed to save contribution' }); }
      contribution_id = data.id;
    }

    let ecopoints_earned = 0;
    try { const { data } = await service.rpc('claim_reward', { p_user_id: user_id, p_type: 'contribution' }); if (typeof data === 'number') ecopoints_earned = data; } catch { /* non-fatal */ }
    const capped = ecopoints_earned === 0;

    const quest_updates: Array<{ title: string; reward: number }> = [];
    try {
      const eventType = type === 'hazard' ? 'aqi_report' : 'place_report';
      const { data } = await service.rpc('record_quest_progress', { p_user_id: user_id, p_event_type: eventType, p_value: 1 });
      if (Array.isArray(data)) for (const q of data as Array<{ completed?: boolean; title?: string; reward?: number }>) if (q?.completed && q.title) quest_updates.push({ title: q.title, reward: q.reward || 0 });
    } catch { /* non-fatal */ }

    try { await service.rpc('increment_contribution_count', { p_user_id: user_id }); } catch { /* non-fatal */ }

    return res.status(200).json({ ok: true, status, ecopoints_earned, capped, contribution_id, region_code, quest_updates, ai: { confidence: ai.confidence, notes: ai.notes } });
  } catch (err) {
    console.error('[contribute/submit] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Mirrors rankWithGemini (api/vayu/route-score.ts). Fail-open to 'pending' — a real
// submission is NEVER blocked by Gemini.
async function sanityCheckContribution(input: {
  type: string; name?: string | null; category?: string | null; description?: string | null;
  lat?: number | null; lng?: number | null; aqi_rating?: number;
}): Promise<{ status: Status; confidence: number | null; notes: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return { status: 'pending', confidence: null, notes: null };

  const coords = typeof input.lat === 'number' && typeof input.lng === 'number' ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : '(none)';
  const prompt = `You moderate community contributions for Breeva, a clean-air navigation app in Indonesian cities (Jakarta, Bandung, Surabaya, Bali). Decide if this submission is a plausible, good-faith entry or spam/gibberish/abuse.

Type: ${input.type}
Name/title: ${input.name || '(none)'}
Category: ${input.category || '(none)'}
Description: ${input.description || '(none)'}
Coordinates: ${coords}
${typeof input.aqi_rating === 'number' ? `Self-reported air severity (1 best .. 5 worst): ${input.aqi_rating}` : ''}

Respond with ONLY valid JSON (no markdown, no backticks):
{"plausible":true|false,"is_spam":true|false,"confidence":0.0-1.0,"reason":"max 12 words, in Indonesian"}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 120, responseMimeType: 'application/json' } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return { status: 'pending', confidence: null, notes: null };
    const json = await resp.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { status: 'pending', confidence: null, notes: null };
    const p = JSON.parse(m[0]);
    const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : null;
    const notes = typeof p.reason === 'string' ? p.reason.slice(0, 160) : null;
    let status: Status = 'pending';
    if (confidence !== null && confidence >= 0.6) {
      if (p.is_spam === true || p.plausible === false) status = 'rejected';
      else if (p.plausible === true && p.is_spam !== true) status = 'approved';
    }
    return { status, confidence, notes };
  } catch {
    clearTimeout(timeout);
    return { status: 'pending', confidence: null, notes: null };
  }
}

// ─── Flow 2: passive VAYU trace (UNCHANGED) ───────────────────────────────────
async function checkRateLimit(ip: string, wayKey: string): Promise<boolean> {
  if (!REDIS_URL || !REDIS_TOKEN) return true;
  const key = `vayu:rl:${ip}:${wayKey}`;
  try {
    const resp = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/1/EX/600/NX`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const data = await resp.json() as { result: string | null };
    return data.result !== null;
  } catch {
    return true;
  }
}

async function handlePassiveTrace(req: VercelRequest, res: VercelResponse, body: ContributeRequest) {
  if (!body.session_id || !isValidUUID(body.session_id)) return res.status(400).json({ error: 'Valid session_id (UUID) required' });
  if (!body.vehicle_type || !VALID_VEHICLE_TYPES.includes(body.vehicle_type)) return res.status(400).json({ error: `vehicle_type must be one of: ${VALID_VEHICLE_TYPES.join(', ')}` });
  if (!body.is_off_road && !body.osm_way_id) return res.status(400).json({ error: 'osm_way_id required when not off-road' });
  if (body.is_off_road && !body.off_road_geohash) return res.status(400).json({ error: 'off_road_geohash required when is_off_road=true' });
  if (body.speed_kmh !== undefined && (body.speed_kmh < 0 || body.speed_kmh > 200)) return res.status(400).json({ error: 'speed_kmh must be 0-200' });
  if (body.off_road_geohash && !/^[0-9a-z]{1,15}$/i.test(body.off_road_geohash)) return res.status(400).json({ error: 'Invalid off_road_geohash format' });

  const clientIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  const wayKey = body.is_off_road ? `offroad:${body.off_road_geohash}` : `way:${body.osm_way_id}`;
  const allowed = await checkRateLimit(clientIP, wayKey);
  if (!allowed) return res.status(429).json({ error: 'Rate limit: 1 contribution per road segment per 10 minutes' });

  try {
    const row: Record<string, unknown> = { session_id: body.session_id, vehicle_type: body.vehicle_type, is_off_road: body.is_off_road || false };
    if (body.osm_way_id) row.osm_way_id = body.osm_way_id;
    if (body.speed_kmh !== undefined) row.speed_kmh = body.speed_kmh;
    if (body.off_road_geohash) row.off_road_geohash = body.off_road_geohash;

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/vayu_contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!resp.ok) { const text = await resp.text(); console.error('Supabase insert error:', resp.status, text); return res.status(502).json({ error: 'Failed to store contribution' }); }
    return res.status(201).json({ ok: true, message: 'Contribution recorded' });
  } catch (error) {
    console.error('VAYU contribute error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
