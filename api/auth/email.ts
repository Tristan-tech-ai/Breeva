import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowedOrigin, makeOtp, normEmail, otpSecret, signChallenge, verifyChallenge } from './_otp.js';

const APP_URL = process.env.VITE_APP_URL || 'https://breeva.site';

// ── Breeva-branded email template ────────────────────────────────
function layout(body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Breeva</title>
</head>
<body style="margin:0;padding:0;background-color:#f0fdf4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#10b981 0%,#059669 50%,#047857 100%);padding:36px 32px;text-align:center;">
  <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:16px;padding:12px 16px;margin-bottom:12px;">
    <span style="font-size:32px;">🍃</span>
  </div>
  <h1 style="margin:0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Breeva</h1>
  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;">Eco Walking Rewards</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:36px 32px 28px;">
${body}
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;">
  <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;text-align:center;">Walk clean routes · Earn EcoPoints · Redeem rewards</p>
  <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;">&copy; ${new Date().getFullYear()} Breeva. All rights reserved.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function verificationEmail(name: string, otp: string) {
  return layout(`
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Verify your email</h2>
  <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
    Hi <strong style="color:#111827;">${escapeHtml(name)}</strong>, welcome to Breeva! 🎉<br/>
    Enter this code to verify your account:
  </p>

  <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px dashed #34d399;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#059669;font-family:'Courier New',monospace;">${escapeHtml(otp)}</span>
  </div>

  <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;">This code expires in <strong style="color:#6b7280;">15 minutes</strong>.</p>
  <p style="margin:0;font-size:13px;color:#9ca3af;">If you didn't create an account, just ignore this email.</p>
  `);
}

function welcomeEmail(name: string) {
  return layout(`
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Welcome to Breeva! 🌿</h2>
  <p style="margin:0 0 20px;font-size:15px;color:#6b7280;line-height:1.6;">
    Hi <strong style="color:#111827;">${escapeHtml(name)}</strong>,<br/>
    Your email is verified! You're all set to start your eco-walking journey.
  </p>

  <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-radius:16px;padding:20px;margin-bottom:24px;">
    <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#065f46;">Here's what you can do:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:4px 0;font-size:14px;color:#047857;">🗺️ &nbsp;Discover clean air routes near you</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#047857;">🏃 &nbsp;Walk and earn EcoPoints</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#047857;">🎁 &nbsp;Redeem at sustainable merchants</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#047857;">🌍 &nbsp;Track your CO₂ impact</td></tr>
    </table>
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <a href="${APP_URL}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:14px;box-shadow:0 4px 14px rgba(16,185,129,0.3);">
      Start Walking
    </a>
  </td></tr>
  </table>
  `);
}

function deleteCodeEmail(name: string, otp: string) {
  return layout(`
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Confirm account deletion</h2>
  <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
    Hi <strong style="color:#111827;">${escapeHtml(name)}</strong>,<br/>
    Enter this code in Breeva to schedule the deletion of your account:
  </p>

  <div style="background:#fef2f2;border:2px dashed #f87171;border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#b91c1c;font-family:'Courier New',monospace;">${escapeHtml(otp)}</span>
  </div>

  <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;">This code expires in <strong style="color:#6b7280;">15 minutes</strong>.</p>
  <p style="margin:0;font-size:13px;color:#9ca3af;">If you did not ask for this, ignore this email; nothing changes.</p>
  `);
}

// ── Simple HTML escape ───────────────────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Send via Resend ──────────────────────────────────────────────
async function sendEmail(key: string, to: string, subject: string, html: string): Promise<{ id: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: 'Breeva <noreply@breeva.site>', to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}`);
  return res.json() as Promise<{ id: string }>;
}

// ── Rate limit (Upstash; fail-open and logged when Redis is unavailable) ──
async function underLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[auth/email] rate limit skipped: Redis not configured');
    return true;
  }
  try {
    const r = await fetch(`${url}/incr/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    const n = Number((await r.json()).result);
    if (n === 1) await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSec}`, { headers: { Authorization: `Bearer ${token}` } });
    return !(n > max);
  } catch (e) {
    console.warn('[auth/email] rate limit skipped:', e instanceof Error ? e.message : e);
    return true;
  }
}

function clientIp(req: VercelRequest): string {
  const f = req.headers['x-forwarded-for'];
  return (Array.isArray(f) ? f[0] : f || '').split(',')[0].trim() || 'unknown';
}

function supabaseEnv() {
  return {
    url: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    anon: process.env.VITE_SUPABASE_ANON_KEY || '',
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

/** Email of the signed-in caller, or null. */
async function authedEmail(req: VercelRequest): Promise<string | null> {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const { url, anon } = supabaseEnv();
  if (!url || !anon) return null;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: h } });
  if (!r.ok) return null;
  const u = (await r.json()) as { email?: string };
  return normEmail(u.email);
}

const cleanName = (n: unknown, fallback: string) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 60) : fallback);

// ── API Handler ──────────────────────────────────────────────────
// Actions:
//   start-signup     {email, name}                          -> code mailed to that address; returns {challenge, expiresAt}
//   complete-signup  {email, name, password, challenge, code} -> account created confirmed (admin API), welcome mailed
//   start-delete     (signed in) {}                         -> code mailed to the caller's own address
//   confirm-delete   (signed in) {challenge, code}          -> request_account_deletion() run as the caller
// The browser never supplies a code, a link or a recipient other than the address being verified or its own.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (allowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', String(origin));
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowedOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  const resendKey = process.env.RESEND_API_KEY;
  const secret = otpSecret(process.env);
  if (!resendKey || !secret) return res.status(500).json({ error: 'Email service not configured' });

  const body = (req.body || {}) as Record<string, unknown>;
  const action = body.action;

  try {
    if (action === 'start-signup') {
      const email = normEmail(body.email);
      if (!email) return res.status(400).json({ error: 'Invalid email' });
      if (!(await underLimit(`mail:rl:e:${email}`, 5, 3600)) || !(await underLimit(`mail:rl:ip:${clientIp(req)}`, 20, 3600))) {
        return res.status(429).json({ error: 'Too many requests, try again later' });
      }
      const code = makeOtp();
      const { challenge, expiresAt } = signChallenge(secret, 'signup', email, code);
      await sendEmail(resendKey, email, `${code} is your Breeva verification code`, verificationEmail(cleanName(body.name, 'there'), code));
      return res.status(200).json({ challenge, expiresAt });
    }

    if (action === 'complete-signup') {
      const email = normEmail(body.email);
      if (!email) return res.status(400).json({ error: 'Invalid email' });
      if (!(await underLimit(`mail:rl:try:${String(body.challenge).slice(-24)}`, 5, 900))) {
        return res.status(429).json({ error: 'Too many attempts, request a new code' });
      }
      const check = verifyChallenge(secret, body.challenge, 'signup', email, body.code);
      if (!check.ok) return res.status(400).json({ error: check.reason === 'expired' ? 'Verification code expired' : 'Invalid verification code' });
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8 to 72 characters' });
      const name = cleanName(body.name, '');
      const { url, service } = supabaseEnv();
      if (!url || !service) return res.status(500).json({ error: 'Auth service not configured' });
      const r = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: service, Authorization: `Bearer ${service}` },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        const exists = r.status === 422 || /already|registered|exists/i.test(t);
        return res.status(exists ? 409 : 502).json({ error: exists ? 'This email is already registered' : 'Could not create the account' });
      }
      await sendEmail(resendKey, email, 'Welcome to Breeva! 🌿', welcomeEmail(name || 'there')).catch((e) => console.warn('[auth/email] welcome failed:', e));
      return res.status(200).json({ ok: true });
    }

    if (action === 'start-delete' || action === 'confirm-delete') {
      const email = await authedEmail(req);
      if (!email) return res.status(401).json({ error: 'Sign in first' });
      if (body.email !== undefined && normEmail(body.email) !== email) return res.status(403).json({ error: 'Recipient must be your own email' });

      if (action === 'start-delete') {
        if (!(await underLimit(`mail:rl:e:${email}`, 5, 3600))) return res.status(429).json({ error: 'Too many requests, try again later' });
        const code = makeOtp();
        const { challenge, expiresAt } = signChallenge(secret, 'delete', email, code);
        await sendEmail(resendKey, email, `${code} confirms your Breeva account deletion`, deleteCodeEmail(cleanName(body.name, 'there'), code));
        return res.status(200).json({ challenge, expiresAt });
      }

      if (!(await underLimit(`mail:rl:try:${String(body.challenge).slice(-24)}`, 5, 900))) {
        return res.status(429).json({ error: 'Too many attempts, request a new code' });
      }
      const check = verifyChallenge(secret, body.challenge, 'delete', email, body.code);
      if (!check.ok) return res.status(400).json({ error: check.reason === 'expired' ? 'Code expired' : 'Invalid code' });
      const { url, anon } = supabaseEnv();
      const r = await fetch(`${url}/rest/v1/rpc/request_account_deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: String(req.headers.authorization) },
        body: '{}',
      });
      if (!r.ok) return res.status(502).json({ error: 'Could not schedule the deletion' });
      const scheduledFor = await r.json().catch(() => null);
      return res.status(200).json({ ok: true, scheduledFor: typeof scheduledFor === 'string' ? scheduledFor : null });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[auth/email] error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
