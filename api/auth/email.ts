import type { VercelRequest, VercelResponse } from '@vercel/node';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.VITE_APP_URL || 'https://breeva.vercel.app';

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

function resetPasswordEmail(name: string, resetLink: string) {
  return layout(`
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Reset your password</h2>
  <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
    Hi <strong style="color:#111827;">${escapeHtml(name || 'there')}</strong>,<br/>
    We received a request to reset your Breeva password. Click the button below to choose a new one:
  </p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding-bottom:24px;">
    <a href="${escapeHtml(resetLink)}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:14px;box-shadow:0 4px 14px rgba(16,185,129,0.3);">
      Reset Password
    </a>
  </td></tr>
  </table>

  <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;">This link expires in <strong style="color:#6b7280;">1 hour</strong>.</p>
  <p style="margin:0 0 16px;font-size:13px;color:#9ca3af;">If you didn't request this, just ignore this email — your password won't change.</p>

  <div style="background:#f9fafb;border-radius:12px;padding:14px 16px;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Can't click the button? Copy this link:</p>
    <p style="margin:4px 0 0;font-size:11px;color:#6b7280;word-break:break-all;">${escapeHtml(resetLink)}</p>
  </div>
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

// ── Simple HTML escape ───────────────────────────────────────────
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Send via Resend ──────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Breeva <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
  return res.json();
}

// ── API Handler ──────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const { type, email, name, otp, resetLink } = req.body || {};

  if (!type || !email) {
    return res.status(400).json({ error: 'Missing required fields: type, email' });
  }

  try {
    let subject: string;
    let html: string;

    switch (type) {
      case 'verification':
        if (!otp) return res.status(400).json({ error: 'Missing otp for verification email' });
        subject = `${otp} is your Breeva verification code`;
        html = verificationEmail(name || 'there', otp);
        break;

      case 'reset':
        if (!resetLink) return res.status(400).json({ error: 'Missing resetLink for reset email' });
        subject = 'Reset your Breeva password';
        html = resetPasswordEmail(name || '', resetLink);
        break;

      case 'welcome':
        subject = 'Welcome to Breeva! 🌿';
        html = welcomeEmail(name || 'there');
        break;

      default:
        return res.status(400).json({ error: `Unknown email type: ${type}` });
    }

    const result = await sendEmail(email, subject, html);
    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    console.error('Email send error:', message);
    return res.status(500).json({ error: message });
  }
}
