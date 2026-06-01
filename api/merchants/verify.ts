import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Consolidated merchant endpoint (Vercel Hobby 12-function cap). Two flows by body.mode:
//   • mode:'register' → server-authoritative merchant registration/edit + Gemini sanity-check
//     (sets status pending/approved/rejected). Mirrors api/vayu/contribute.ts.
//   • default (no mode) → redemption QR verify (UNCHANGED — owner marks a voucher used).

export const config = { maxDuration: 15 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if ((req.body || {}).mode === 'register') return handleMerchantRegister(req, res);
  return handleRedeemVerify(req, res);
}

async function getAuthUser(req: VercelRequest): Promise<{ id: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase auth type omits getUser in some resolutions (same cast as api/walks/complete.ts)
  const { data: { user }, error } = await (userClient.auth as any).getUser();
  if (error || !user) return null;
  return { id: user.id };
}

const clamp = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
const httpUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.startsWith('http') ? v.slice(0, 500) : null;

// ─── Flow 1: merchant register / edit (server-authoritative, Gemini-gated) ──────
type Status = 'pending' | 'approved' | 'rejected';

async function handleMerchantRegister(req: VercelRequest, res: VercelResponse) {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured: missing Supabase service role' });
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.user_id === 'string' && body.user_id !== authUser.id) {
      return res.status(403).json({ error: 'Forbidden: user mismatch' });
    }
    const uid = authUser.id;
    const merchant_id = typeof body.merchant_id === 'string' ? body.merchant_id : null;

    const name = clamp(body.name, 120);
    if (!name || name.length < 3) return res.status(400).json({ error: 'Business name must be at least 3 characters' });
    const category = clamp(body.category, 60);
    const description = clamp(body.description, 800);
    const address = clamp(body.address, 240);
    const lat = Number.isFinite(body.lat) ? Number(body.lat) : null;
    const lng = Number.isFinite(body.lng) ? Number(body.lng) : null;

    // Editable profile fields (only set when provided — undefined keys are dropped below).
    const fields: Record<string, unknown> = {
      name, category, description, address,
      phone: clamp(body.phone, 40),
      website: httpUrl(body.website),
      instagram: clamp(body.instagram, 80),
      whatsapp: clamp(body.whatsapp, 40),
      logo_url: httpUrl(body.logo_url),
      cover_image_url: httpUrl(body.cover_image_url),
      document_url: httpUrl(body.document_url),
    };
    if (lat !== null && Math.abs(lat) <= 90) fields.lat = lat;
    if (lng !== null && Math.abs(lng) <= 180) fields.lng = lng;
    if (body.opening_hours && typeof body.opening_hours === 'object') fields.opening_hours = body.opening_hours;
    if (Array.isArray(body.gallery_urls)) fields.gallery_urls = (body.gallery_urls as unknown[]).filter((u) => typeof u === 'string' && (u as string).startsWith('http')).slice(0, 12);
    for (const k of Object.keys(fields)) if (fields[k] === null || fields[k] === undefined) delete fields[k];

    const ai = await sanityCheckMerchant({ name, category, description, address, lat, lng });
    const status: Status = ai.status;
    const is_verified = status === 'approved';
    const is_active = status !== 'rejected';
    const validated_at = status === 'pending' ? null : new Date().toISOString();
    const verdict = { status, is_verified, is_active, ai_confidence: ai.confidence, ai_notes: ai.notes, validated_at };

    if (merchant_id) {
      const { data: existing } = await supabase.from('merchants').select('owner_id').eq('id', merchant_id).single();
      if (!existing || existing.owner_id !== uid) return res.status(403).json({ error: 'Forbidden: not merchant owner' });
      const { data, error } = await supabase.from('merchants')
        .update({ ...fields, ...verdict, updated_at: new Date().toISOString() })
        .eq('id', merchant_id).select('id').single();
      if (error || !data) { console.error('[merchant/register] update error:', error); return res.status(500).json({ error: 'Failed to save merchant' }); }
      return res.status(200).json({ ok: true, merchant_id: data.id, status, is_verified, ai: { confidence: ai.confidence, notes: ai.notes } });
    }

    const { data, error } = await supabase.from('merchants')
      .insert({ ...fields, owner_id: uid, ...verdict })
      .select('id').single();
    if (error || !data) { console.error('[merchant/register] insert error:', error); return res.status(500).json({ error: 'Failed to register merchant' }); }
    return res.status(200).json({ ok: true, merchant_id: data.id, status, is_verified, ai: { confidence: ai.confidence, notes: ai.notes } });
  } catch (err) {
    console.error('[merchant/register] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Mirrors sanityCheckContribution (api/vayu/contribute.ts). Fail-open to 'pending' — never block a real registration.
async function sanityCheckMerchant(input: {
  name: string | null; category: string | null; description: string | null; address: string | null;
  lat: number | null; lng: number | null;
}): Promise<{ status: Status; confidence: number | null; notes: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return { status: 'pending', confidence: null, notes: null };

  const coords = typeof input.lat === 'number' && typeof input.lng === 'number' ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : '(none)';
  const prompt = `You moderate merchant sign-ups for Breeva, an eco-friendly business directory in Indonesian cities (Jakarta, Bandung, Surabaya, Bali). Decide if this is a plausible, good-faith real local business listing or spam/gibberish/abuse/fake.

Name: ${input.name || '(none)'}
Category: ${input.category || '(none)'}
Description: ${input.description || '(none)'}
Address: ${input.address || '(none)'}
Coordinates: ${coords}

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

// ─── Flow 2: redemption QR verify (UNCHANGED behaviour) ─────────────────────────
async function handleRedeemVerify(req: VercelRequest, res: VercelResponse) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Invalid or expired token' });

    const { qr_code, merchant_id } = (req.body || {}) as { qr_code?: string; merchant_id?: string };
    if (!qr_code || !merchant_id) return res.status(400).json({ error: 'QR code and merchant ID required' });

    const { data: merchant, error: merchantErr } = await supabase
      .from('merchants').select('id, owner_id').eq('id', merchant_id).single();
    if (merchantErr || !merchant) return res.status(404).json({ error: 'Merchant not found' });
    if (merchant.owner_id !== authUser.id) return res.status(403).json({ error: 'Forbidden: not merchant owner' });

    const { data: redemption, error } = await supabase
      .from('redeemed_rewards')
      .select(`*, reward:rewards(*), user:users(full_name, email)`)
      .eq('qr_code', qr_code).eq('merchant_id', merchant_id).single();
    if (error || !redemption) {
      return res.status(404).json({ valid: false, error: 'Reward not found or does not belong to this merchant' });
    }
    if (redemption.status === 'used') {
      return res.status(400).json({ valid: false, error: 'Reward has already been used', used_at: redemption.used_at });
    }
    if (redemption.status === 'expired' || new Date(redemption.expires_at) < new Date()) {
      return res.status(400).json({ valid: false, error: 'Reward has expired', expired_at: redemption.expires_at });
    }

    const { error: updateError } = await supabase
      .from('redeemed_rewards').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', redemption.id);
    if (updateError) { console.error('Failed to update redemption:', updateError); return res.status(500).json({ error: 'Failed to verify reward' }); }

    return res.status(200).json({
      valid: true,
      reward: {
        title: redemption.reward.title,
        description: redemption.reward.description,
        discount_percentage: redemption.reward.discount_percentage,
        discount_amount: redemption.reward.discount_amount,
      },
      user: { name: redemption.user.full_name },
      verified_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Verify reward error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
