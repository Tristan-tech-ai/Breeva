import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseStartRegion, FIELD_REGIONS, rememberRegion, startRegionHere } from '../src/lib/field/source';

// F1-52: the app map (/home) must start where roads have colour, never in Jakarta (no published field there).
describe('chooseStartRegion', () => {
  it('defaults to Badung-Denpasar', () => {
    expect(chooseStartRegion({}).name).toBe('badung_denpasar');
    expect(chooseStartRegion({ timeZone: 'Asia/Makassar' }).name).toBe('badung_denpasar');
    expect(chooseStartRegion({ timeZone: 'Europe/Amsterdam' }).name).toBe('badung_denpasar');
  });
  it('starts a WIB phone in Kota Bogor', () => {
    expect(chooseStartRegion({ timeZone: 'Asia/Jakarta' }).name).toBe('kota_bogor');
    expect(chooseStartRegion({ timeZone: 'Asia/Pontianak' }).name).toBe('kota_bogor');
  });
  it('prefers the URL, then the region last used, then the time zone', () => {
    expect(chooseStartRegion({ param: 'badung_denpasar', stored: 'kota_bogor', timeZone: 'Asia/Jakarta' }).name).toBe('badung_denpasar');
    expect(chooseStartRegion({ stored: 'badung_denpasar', timeZone: 'Asia/Jakarta' }).name).toBe('badung_denpasar');
    expect(chooseStartRegion({ stored: 'kota_bogor', timeZone: 'Asia/Makassar' }).name).toBe('kota_bogor');
  });
  it('ignores names that are not field regions', () => {
    expect(chooseStartRegion({ param: 'jakarta', stored: 'surabaya', timeZone: 'Asia/Makassar' }).name).toBe('badung_denpasar');
  });
  it('always returns a region whose home lies inside its own bounds', () => {
    for (const tz of ['Asia/Jakarta', 'Asia/Makassar', 'UTC']) {
      const r = chooseStartRegion({ timeZone: tz });
      const [[s, w], [n, e]] = r.bounds;
      expect(r.home.lat).toBeGreaterThanOrEqual(s); expect(r.home.lat).toBeLessThanOrEqual(n);
      expect(r.home.lng).toBeGreaterThanOrEqual(w); expect(r.home.lng).toBeLessThanOrEqual(e);
    }
  });
});

describe('startRegionHere and rememberRegion', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('reads the stored region written by rememberRegion', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    rememberRegion('kota_bogor');
    expect(startRegionHere().name).toBe('kota_bogor');
  });
  it('falls back when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => rememberRegion('kota_bogor')).not.toThrow();
    expect(FIELD_REGIONS.map((r) => r.name)).toContain(startRegionHere().name);
  });
});
