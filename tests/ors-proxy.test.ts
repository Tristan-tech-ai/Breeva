import { describe, expect, it } from 'vitest';
import { buildOrsRequest, withOrsKey } from '../api/searchapi/_ors';

const walk = { coordinates: [[115.2, -8.65], [115.21, -8.66]] };

describe('ORS proxy request builder', () => {
  it('builds a directions POST without the key and with only whitelisted fields', () => {
    const r = buildOrsRequest('POST', { op: 'directions', profile: 'foot-walking' }, {
      ...walk, preference: 'shortest', alternative_routes: { target_count: 3, share_factor: 0.3, weight_factor: 2 },
      options: { avoid_features: ['steps'] }, extra_info: ['suitability'], api_key: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.upstream.url).toBe('https://api.openrouteservice.org/v2/directions/foot-walking/geojson');
    const body = JSON.parse(r.upstream.body!);
    expect(Object.keys(body).sort()).toEqual(['alternative_routes', 'coordinates', 'instructions', 'options', 'preference', 'units']);
    expect(r.upstream.cacheTtlSec).toBe(0);
  });

  it('rejects an unknown profile, a bad coordinate and too many points', () => {
    expect(buildOrsRequest('POST', { op: 'directions', profile: 'driving-hgv' }, walk)).toMatchObject({ ok: false, status: 400 });
    expect(buildOrsRequest('POST', { op: 'directions' }, { coordinates: [[115.2, -95], [115.2, -8]] })).toMatchObject({ ok: false });
    const many = { coordinates: Array.from({ length: 13 }, (_, i) => [115 + i / 100, -8.6]) };
    expect(buildOrsRequest('POST', { op: 'directions' }, many)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses the wrong method and unknown operations', () => {
    expect(buildOrsRequest('GET', { op: 'directions' }, walk)).toMatchObject({ ok: false, status: 405 });
    expect(buildOrsRequest('POST', { op: 'geocode', text: 'x' }, null)).toMatchObject({ ok: false, status: 405 });
    expect(buildOrsRequest('GET', { op: 'matrix' }, null)).toMatchObject({ ok: false, status: 400 });
  });

  it('builds geocode and reverse GETs with caching and without a client-supplied key', () => {
    const g = buildOrsRequest('GET', { op: 'geocode', text: 'SMK TI Bali Global', lat: '-8.65', lon: '115.2', api_key: 'stolen' }, null);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const gu = new URL(g.upstream.url);
    expect(gu.searchParams.get('text')).toBe('SMK TI Bali Global');
    expect(gu.searchParams.get('focus.point.lat')).toBe('-8.65');
    expect(gu.searchParams.has('api_key')).toBe(false);
    expect(g.upstream.cacheTtlSec).toBeGreaterThan(0);
    const r = buildOrsRequest('GET', { op: 'reverse', lat: '-8.650012', lon: '115.216789' }, null);
    expect(r.ok && new URL(r.upstream.url).searchParams.get('point.lat')).toBe('-8.6500');
    expect(buildOrsRequest('GET', { op: 'geocode', text: 'x'.repeat(201) }, null)).toMatchObject({ ok: false });
  });

  it('puts the key in the query for GET and in the Authorization header for POST', () => {
    const g = buildOrsRequest('GET', { op: 'reverse', lat: '-8.6', lon: '115.2' }, null);
    const p = buildOrsRequest('POST', { op: 'directions' }, walk);
    if (!g.ok || !p.ok) throw new Error('build failed');
    expect(new URL(withOrsKey(g.upstream, 'K').url).searchParams.get('api_key')).toBe('K');
    const post = withOrsKey(p.upstream, 'K');
    expect(post.url).not.toContain('K');
    expect((post.init.headers as Record<string, string>).Authorization).toBe('K');
  });
});
