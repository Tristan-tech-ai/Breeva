/**
 * One-time codes made and checked on the server.
 *
 * The code is never sent to the browser. The browser receives a signed challenge that binds the purpose, the email
 * address and the expiry to an HMAC of the code; to finish, it sends the challenge back with the code the user typed.
 * No database row is needed, so this keeps working while the database is read-only.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto';

export type OtpPurpose = 'signup' | 'delete';
export const OTP_TTL_MS = 15 * 60 * 1000;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function makeOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function normEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const s = e.trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function mac(secret: string, purpose: string, email: string, exp: number, code: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}|${email}|${exp}|${code}`).digest();
}

export function signChallenge(secret: string, purpose: OtpPurpose, email: string, code: string, now = Date.now()): { challenge: string; expiresAt: number } {
  const exp = now + OTP_TTL_MS;
  const head = b64url(JSON.stringify({ p: purpose, e: email, x: exp }));
  return { challenge: `${head}.${b64url(mac(secret, purpose, email, exp, code))}`, expiresAt: exp };
}

export type ChallengeCheck = { ok: true; email: string } | { ok: false; reason: 'malformed' | 'purpose' | 'email' | 'expired' | 'code' };

export function verifyChallenge(secret: string, challenge: unknown, purpose: OtpPurpose, email: string | null, code: unknown, now = Date.now()): ChallengeCheck {
  if (typeof challenge !== 'string' || typeof code !== 'string') return { ok: false, reason: 'malformed' };
  const [head, sig, extra] = challenge.split('.');
  if (!head || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
  let body: { p?: unknown; e?: unknown; x?: unknown };
  try {
    body = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (body.p !== purpose) return { ok: false, reason: 'purpose' };
  if (typeof body.e !== 'string' || (email !== null && body.e !== email)) return { ok: false, reason: 'email' };
  if (typeof body.x !== 'number' || now > body.x) return { ok: false, reason: 'expired' };
  const want = mac(secret, purpose, body.e, body.x, code.trim());
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'code' };
  return { ok: true, email: body.e };
}

/** Browsers that may call the email endpoint. Non-browser callers send no Origin and are refused. */
export function allowedOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false;
  return /^https:\/\/(www\.)?breeva\.site$/.test(origin)
    || /^https:\/\/breeva(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

/** HMAC key: EMAIL_OTP_SECRET if set, otherwise derived from the service role key (server-only either way). */
export function otpSecret(env: Record<string, string | undefined>): string | null {
  if (env.EMAIL_OTP_SECRET) return env.EMAIL_OTP_SECRET;
  if (env.SUPABASE_SERVICE_ROLE_KEY) return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update('breeva-email-otp-v1').digest('hex');
  return null;
}
