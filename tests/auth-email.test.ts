import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../api/auth/email';
import { allowedOrigin, makeOtp, signChallenge, verifyChallenge } from '../api/auth/_otp';

type Sent = { url: string; init?: RequestInit };

function mockRes() {
  const r = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    setHeader: (k: string, v: string) => { r.headers[k] = v; return res; },
    status: (c: number) => { r.statusCode = c; return res; },
    json: (b: unknown) => { r.body = b; return res; },
    end: () => res,
  };
  return { res: res as unknown as VercelResponse, r };
}

function req(body: Record<string, unknown>, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'POST', headers: { origin: 'https://breeva.site', ...headers }, body } as unknown as VercelRequest;
}

let sent: Sent[];
let userEmail: string | null;

beforeEach(() => {
  sent = [];
  userEmail = 'owner@example.com';
  vi.stubEnv('RESEND_API_KEY', 'test-resend');
  vi.stubEnv('EMAIL_OTP_SECRET', 'test-secret');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.example');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    if (url.endsWith('/auth/v1/user')) {
      return userEmail ? new Response(JSON.stringify({ email: userEmail })) : new Response('{}', { status: 401 });
    }
    if (url.endsWith('/auth/v1/admin/users')) return new Response(JSON.stringify({ id: 'u1' }));
    if (url.includes('/rest/v1/rpc/request_account_deletion')) return new Response(JSON.stringify('2026-12-16T00:00:00Z'));
    if (url.startsWith('https://api.resend.com')) return new Response(JSON.stringify({ id: 'mail1' }));
    return new Response('not mocked', { status: 500 });
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mails = () => sent.filter((s) => s.url.startsWith('https://api.resend.com')).map((s) => JSON.parse(String(s.init?.body)));

describe('auth/email handler', () => {
  it('refuses callers without an allowed origin (403)', async () => {
    const { res, r } = mockRes();
    await handler(req({ action: 'start-signup', email: 'a@example.com' }, { origin: 'https://evil.example' }), res);
    expect(r.statusCode).toBe(403);
    const { res: res2, r: r2 } = mockRes();
    await handler({ method: 'POST', headers: {}, body: { action: 'start-signup', email: 'a@example.com' } } as unknown as VercelRequest, res2);
    expect(r2.statusCode).toBe(403);
    expect(mails()).toHaveLength(0);
  });

  it('no longer relays a caller-made code, link or template', async () => {
    for (const body of [
      { type: 'verification', email: 'victim@example.com', otp: '123456' },
      { type: 'reset', email: 'victim@example.com', resetLink: 'https://phish.example' },
      { type: 'welcome', email: 'victim@example.com' },
    ]) {
      const { res, r } = mockRes();
      await handler(req(body), res);
      expect(r.statusCode).toBe(400);
    }
    expect(mails()).toHaveLength(0);
  });

  it('refuses a recipient other than the signed-in user (403)', async () => {
    const { res, r } = mockRes();
    await handler(req({ action: 'start-delete', email: 'victim@example.com' }, { authorization: 'Bearer t' }), res);
    expect(r.statusCode).toBe(403);
    expect(mails()).toHaveLength(0);
  });

  it('requires a session for the deletion code (401)', async () => {
    userEmail = null;
    const { res, r } = mockRes();
    await handler(req({ action: 'start-delete' }, { authorization: 'Bearer bad' }), res);
    expect(r.statusCode).toBe(401);
  });

  it('mails a server-made signup code and never returns it to the browser', async () => {
    const { res, r } = mockRes();
    await handler(req({ action: 'start-signup', email: 'New@Example.com', name: '<b>Ani</b>' }), res);
    expect(r.statusCode).toBe(200);
    const m = mails();
    expect(m).toHaveLength(1);
    expect(m[0].to).toEqual(['new@example.com']);
    const code = /(\d{6}) is your Breeva/.exec(m[0].subject)![1];
    expect(m[0].html).toContain('&lt;b&gt;Ani&lt;/b&gt;');
    expect(JSON.stringify(r.body)).not.toContain(code);
    const body = r.body as { challenge: string };

    const bad = mockRes();
    await handler(req({ action: 'complete-signup', email: 'new@example.com', password: 'longenough', challenge: body.challenge, code: code === '000000' ? '000001' : '000000' }), bad.res);
    expect(bad.r.statusCode).toBe(400);
    expect(sent.some((s) => s.url.endsWith('/auth/v1/admin/users'))).toBe(false);

    const good = mockRes();
    await handler(req({ action: 'complete-signup', email: 'new@example.com', password: 'longenough', name: 'Ani', challenge: body.challenge, code }), good.res);
    expect(good.r.statusCode).toBe(200);
    const created = sent.find((s) => s.url.endsWith('/auth/v1/admin/users'))!;
    expect(JSON.parse(String(created.init?.body))).toMatchObject({ email: 'new@example.com', email_confirm: true });
  });

  it('a signup challenge cannot be used for another address', async () => {
    const { res, r } = mockRes();
    await handler(req({ action: 'start-signup', email: 'a@example.com' }), res);
    const code = /(\d{6})/.exec(mails()[0].subject)![1];
    const other = mockRes();
    await handler(req({ action: 'complete-signup', email: 'b@example.com', password: 'longenough', challenge: (r.body as { challenge: string }).challenge, code }), other.res);
    expect(other.r.statusCode).toBe(400);
  });

  it('runs the deletion only after the mailed code is entered', async () => {
    const start = mockRes();
    await handler(req({ action: 'start-delete' }, { authorization: 'Bearer t' }), start.res);
    expect(start.r.statusCode).toBe(200);
    expect(mails()[0].to).toEqual(['owner@example.com']);
    const code = /(\d{6})/.exec(mails()[0].subject)![1];
    const done = mockRes();
    await handler(req({ action: 'confirm-delete', challenge: (start.r.body as { challenge: string }).challenge, code }, { authorization: 'Bearer t' }), done.res);
    expect(done.r.statusCode).toBe(200);
    expect(done.r.body).toMatchObject({ ok: true, scheduledFor: '2026-12-16T00:00:00Z' });
  });
});

describe('one-time code primitives', () => {
  it('codes are six digits', () => {
    for (let i = 0; i < 50; i++) expect(makeOtp()).toMatch(/^\d{6}$/);
  });

  it('a challenge expires, binds its purpose and rejects tampering', () => {
    const { challenge } = signChallenge('s', 'signup', 'a@example.com', '123456', 1_000);
    expect(verifyChallenge('s', challenge, 'signup', 'a@example.com', '123456', 2_000)).toEqual({ ok: true, email: 'a@example.com' });
    expect(verifyChallenge('s', challenge, 'signup', 'a@example.com', '123456', 1_000 + 16 * 60_000)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyChallenge('s', challenge, 'delete', 'a@example.com', '123456', 2_000)).toMatchObject({ ok: false, reason: 'purpose' });
    expect(verifyChallenge('other', challenge, 'signup', 'a@example.com', '123456', 2_000)).toMatchObject({ ok: false, reason: 'code' });
    const [head] = challenge.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'signup', e: 'a@example.com', x: 9e15 })).toString('base64url');
    expect(verifyChallenge('s', challenge.replace(head, forged), 'signup', 'a@example.com', '123456', 2_000)).toMatchObject({ ok: false, reason: 'code' });
  });

  it('allows only Breeva and local origins', () => {
    expect(allowedOrigin('https://breeva.site')).toBe(true);
    expect(allowedOrigin('http://localhost:5173')).toBe(true);
    expect(allowedOrigin('https://breeva.site.evil.example')).toBe(false);
    expect(allowedOrigin(undefined)).toBe(false);
  });
});
