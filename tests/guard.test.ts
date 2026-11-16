import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cronStatus, rateLimit } from '../api/vayu/_guard';
import { geoapifyParams, searchApiParams } from '../api/searchapi/_params';

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as VercelRequest;

function mockRes() {
  const r = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  const res = {
    setHeader: (k: string, v: string) => { r.headers[k] = v; return res; },
    status: (c: number) => { r.statusCode = c; return res; },
    json: (b: unknown) => { r.body = b; return res; },
  };
  return { res: res as unknown as VercelResponse, r };
}

/** Upstash stand-in with real INCR semantics. */
function fakeUpstash() {
  const counts = new Map<string, number>();
  const fetchImpl = (async (url: string) => {
    const m = /\/incr\/(.+)$/.exec(url);
    if (m) {
      const k = decodeURIComponent(m[1]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return new Response(JSON.stringify({ result: counts.get(k) }));
    }
    return new Response(JSON.stringify({ result: 1 }));
  }) as unknown as typeof fetch;
  return { counts, fetchImpl };
}

const ENV = { UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 't' };

afterEach(() => vi.restoreAllMocks());

describe('rate limit', () => {
  it('lets the first N requests of a minute through and answers 429 after', async () => {
    const { fetchImpl } = fakeUpstash();
    const now = 1_700_000_000_000;
    const ip = req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    for (let i = 0; i < 3; i++) expect(await rateLimit(ip, mockRes().res, 'routeScore', 3, ENV, fetchImpl, now)).toBe(true);
    const { res, r } = mockRes();
    expect(await rateLimit(ip, res, 'routeScore', 3, ENV, fetchImpl, now)).toBe(false);
    expect(r.statusCode).toBe(429);
    // another address and the next minute have their own windows
    expect(await rateLimit(req({ 'x-forwarded-for': '198.51.100.2' }), mockRes().res, 'routeScore', 3, ENV, fetchImpl, now)).toBe(true);
    expect(await rateLimit(ip, mockRes().res, 'routeScore', 3, ENV, fetchImpl, now + 60_000)).toBe(true);
  });

  it('fails open, with a log line, when Redis is missing or down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await rateLimit(req(), mockRes().res, 'aqi', 1, ENV, down)).toBe(true);
    expect(await rateLimit(req(), mockRes().res, 'aqi', 1, {}, down)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe('cron secret', () => {
  it('no header is an ordinary request, never a cron call', () => {
    expect(cronStatus(req(), { BREEVA_CRON_SECRET: 's3cret' })).toBe('absent');
  });

  it('accepts only the configured secret, and nothing when none is configured', () => {
    const h = (v: string) => req({ 'x-breeva-cron-secret': v });
    expect(cronStatus(h('s3cret'), { BREEVA_CRON_SECRET: 's3cret' })).toBe('valid');
    expect(cronStatus(h(' s3cret\n'), { BREEVA_CRON_SECRET: 's3cret ' })).toBe('valid');
    expect(cronStatus(h('guess'), { BREEVA_CRON_SECRET: 's3cret' })).toBe('invalid');
    expect(cronStatus(h('anything'), {})).toBe('invalid');
    expect(cronStatus(h('anything'), { BREEVA_CRON_SECRET: '  ' })).toBe('invalid');
  });
});

describe('search proxy parameters', () => {
  it('forwards only the whitelisted SearchAPI params', () => {
    const r = searchApiParams('google_maps', { engine: 'google_maps', q: 'puskesmas', ll: '@-8.6,115.2,15z', hl: 'id', api_key: 'x', num: '100', location: 'x' });
    expect(r.ok && [...r.params.keys()].sort()).toEqual(['hl', 'll', 'q']);
    expect(searchApiParams('google_shopping', { q: 'x' }).ok).toBe(false);
    expect(searchApiParams('google_maps', { q: 'x'.repeat(301) }).ok).toBe(false);
  });

  it('forwards only the whitelisted Geoapify params and caps the limit', () => {
    const r = geoapifyParams({ provider: 'geoapify', categories: 'healthcare', filter: 'circle:115.2,-8.6,500', limit: '20', apiKey: 'x', format: 'geojson' });
    expect(r.ok && [...r.params.keys()].sort()).toEqual(['categories', 'filter', 'limit']);
    expect(geoapifyParams({ categories: 'x', limit: '1000' }).ok).toBe(false);
    expect(geoapifyParams({ filter: 'rect:1,2,3,4' }).ok).toBe(false);
  });
});
