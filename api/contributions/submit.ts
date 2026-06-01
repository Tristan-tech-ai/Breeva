import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-authoritative contribution handler. Mirrors api/walks/complete.ts:
//   * Bearer-token auth (the browser never holds the service role)
//   * ALL writes via the service-role client (bypasses RLS; client has no INSERT policy)
//   * points/quests granted ONLY through the locked RPCs (claim_reward / record_quest_progress)
//   * returns the REAL points earned + validation status (no client-side "+25" lie)
// Persists every contribution type: 'hazard' → air_quality_reports, POI → place_contributions.

export const config = { maxDuration: 15 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[contributions/submit] FATAL: missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PLACE_TYPES = ['missing_place', 'eco_merchant', 'green_space'] as const;
const ALL_TYPES = ['hazard', ...PLACE_TYPES] as const;
type ContributionType = (typeof ALL_TYPES)[number];

interface SubmitBody {
  type: ContributionType;
  user_id: string;
  name?: string;
  category?: string;
  description?: string;
  lat?: number;
  lng?: number;
  aqi_rating?: number;      // hazard: self-reported severity 1 (best) .. 5 (worst)
  photo_url?: string;
}

type Status = 'pending' | 'approved' | 'rejected';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase service role' });
  }

  try {
    // ── Auth: verify the Bearer belongs to user_id ───────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser();
    if (authError || !authUser) return res.status(401).json({ error: 'Invalid or expired token' });

    const body = (req.body || {}) as SubmitBody;
    const { type, user_id } = body;

    if (!type || !ALL_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid contribution type' });
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (user_id !== authUser.id) return res.status(403).json({ error: 'Forbidden: user mismatch' });

    // ── Normalize + per-type validation ──────────────────────────────────────
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const category = typeof body.category === 'string' ? body.category.trim().slice(0, 60) : null;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 600) : null;
    const photo_url = typeof body.photo_url === 'string' && body.photo_url.startsWith('http') ? body.photo_url : null;
    const lat = Number.isFinite(body.lat) ? Number(body.lat) : null;
    const lng = Number.isFinite(body.lng) ? Number(body.lng) : null;
    const hasCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    if (type === 'hazard') {
      if (!hasCoords) return res.status(400).json({ error: 'Location required for an air-quality report' });
    } else {
      if (name.length < 3) return res.status(400).json({ error: 'Name must be at least 3 characters' });
    }
    let aqiRating = Number.isFinite(body.aqi_rating) ? Math.round(Number(body.aqi_rating)) : 4;
    aqiRating = Math.max(1, Math.min(5, aqiRating));

    // ── Region (non-fatal) ───────────────────────────────────────────────────
    let region_code: string | null = null;
    if (hasCoords) {
      try {
        const { data } = await service.rpc('breeva_nearest_region', { p_lat: lat, p_lng: lng });
        if (typeof data === 'string') region_code = data;
      } catch { /* non-fatal */ }
    }

    // ── Lightweight Gemini sanity-check (fail-open to 'pending') ──────────────
    const ai = await sanityCheckContribution({ type, name, category, description, lat, lng, aqi_rating: type === 'hazard' ? aqiRating : undefined });
    const status: Status = ai.status;
    const validated_at = status === 'pending' ? null : new Date().toISOString();

    // ── Persist (service role → bypasses RLS) ────────────────────────────────
    let contribution_id: string;
    if (type === 'hazard') {
      const { data, error } = await service.from('air_quality_reports').insert({
        user_id,
        lat, lng,
        aqi_rating: aqiRating,
        description: name ? (description ? `${name} — ${description}` : name) : (description || 'Laporan kualitas udara'),
        ...(photo_url ? { photo_url } : {}),
        status, ai_confidence: ai.confidence, ai_notes: ai.notes, validated_at,
        source: 'report',
      }).select('id').single();
      if (error || !data) {
        console.error('[contributions/submit] aqr insert error:', error);
        return res.status(500).json({ error: 'Failed to save contribution' });
      }
      contribution_id = data.id;
    } else {
      const { data, error } = await service.from('place_contributions').insert({
        user_id, type, name, category, description,
        lat, lng,
        ...(photo_url ? { photo_url } : {}),
        status, region_code, ai_confidence: ai.confidence, ai_notes: ai.notes, validated_at,
      }).select('id').single();
      if (error || !data) {
        console.error('[contributions/submit] place insert error:', error);
        return res.status(500).json({ error: 'Failed to save contribution' });
      }
      contribution_id = data.id;
    }

    // ── Gamification (ALL non-fatal — a row already persisted) ────────────────
    let ecopoints_earned = 0;
    try {
      const { data } = await service.rpc('claim_reward', { p_user_id: user_id, p_type: 'contribution' });
      if (typeof data === 'number') ecopoints_earned = data;
    } catch { /* non-fatal */ }
    const capped = ecopoints_earned === 0;

    const quest_updates: Array<{ title: string; reward: number }> = [];
    try {
      const eventType = type === 'hazard' ? 'aqi_report' : 'place_report';
      const { data } = await service.rpc('record_quest_progress', { p_user_id: user_id, p_event_type: eventType, p_value: 1 });
      if (Array.isArray(data)) {
        for (const q of data as Array<{ completed?: boolean; title?: string; reward?: number }>) {
          if (q?.completed && q.title) quest_updates.push({ title: q.title, reward: q.reward || 0 });
        }
      }
    } catch { /* non-fatal */ }

    try {
      await service.rpc('increment_contribution_count', { p_user_id: user_id });
    } catch { /* non-fatal */ }

    return res.status(200).json({
      ok: true,
      status,
      ecopoints_earned,
      capped,
      contribution_id,
      region_code,
      quest_updates,
      ai: { confidence: ai.confidence, notes: ai.notes },
    });
  } catch (err) {
    console.error('[contributions/submit] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Mirrors rankWithGemini (api/vayu/route-score.ts): gemini-2.5-flash-lite, AbortController,
// tolerant JSON parse. Fail-open to 'pending' so a real submission is NEVER blocked by Gemini.
async function sanityCheckContribution(input: {
  type: string; name?: string | null; category?: string | null; description?: string | null;
  lat?: number | null; lng?: number | null; aqi_rating?: number;
}): Promise<{ status: Status; confidence: number | null; notes: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return { status: 'pending', confidence: null, notes: null };

  const coords = typeof input.lat === 'number' && typeof input.lng === 'number'
    ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : '(none)';
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
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 120, responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      },
    );
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
