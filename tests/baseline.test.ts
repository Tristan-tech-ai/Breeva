import { describe, expect, it } from 'vitest';
import {
  baselineCacheKey, buildInterpolator, fetchBaselineBatch, fetchBaselineGrid, meanDirection, parseCachedCorners,
  type BaselineData,
} from '../api/vayu/_baseline';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    redisGet: async (k: string) => store.get(k) ?? null,
    redisSetEx: async (k: string, _ttl: number, v: string) => { store.set(k, v); },
  };
}

/** Open-Meteo stand-in: 5 points, wind from `dir` degrees. */
function fakeOpenMeteo(dir: number, calls: string[]) {
  return (async (url: string) => {
    calls.push(url);
    const point = url.includes('air-quality')
      ? { current: { pm2_5: 30, pm10: 45, nitrogen_dioxide: 20, carbon_monoxide: 300, ozone: 40 } }
      : { current: { wind_speed_10m: 3, wind_direction_10m: dir } };
    return new Response(JSON.stringify(Array.from({ length: 5 }, () => point)));
  }) as unknown as typeof fetch;
}

const bbox = [-8.70, 115.17, -8.62, 115.25] as const; // Denpasar

describe('shared Open-Meteo background', () => {
  it('a cache entry written by route-score carries the wind direction road-aqi needs', async () => {
    const redis = fakeRedis();
    const calls: string[] = [];
    // route-score fills the cache (1 h TTL) ...
    await fetchBaselineGrid(...bbox, 0, { ...redis, ttlSec: 3600, fetchImpl: fakeOpenMeteo(250, calls) });
    expect(calls).toHaveLength(2);
    // ... road-aqi reads it without fetching again and sees a 250 degree wind, not 0.
    const fetchMustNotRun = (async () => { throw new Error('should be a cache hit'); }) as unknown as typeof fetch;
    const { center, interpolate } = await fetchBaselineGrid(...bbox, 0, { ...redis, ttlSec: 900, fetchImpl: fetchMustNotRun });
    expect(center.wind_direction).toBe(250);
    expect(interpolate(-8.65, 115.21).wind_direction).toBeCloseTo(250, 6);
  });

  it('ignores the old key and any cache entry without wind direction', async () => {
    const redis = fakeRedis();
    const noDir = { pm25: 30, pm10: 45, no2: 20, co: 300, o3: 40, wind_speed: 3 };
    const legacy = JSON.stringify({ center: noDir, nw: noDir, ne: noDir, sw: noDir, se: noDir });
    redis.store.set('vayu:bl:-8.70:115.20:fh0', legacy);              // old route-score shape, old key
    redis.store.set(baselineCacheKey(-8.7, 115.2, 0), legacy);         // even under the new key
    expect(parseCachedCorners(legacy)).toBeNull();
    const calls: string[] = [];
    const { center } = await fetchBaselineGrid(...bbox, 0, { ...redis, ttlSec: 900, fetchImpl: fakeOpenMeteo(120, calls) });
    expect(calls).toHaveLength(2); // refetched instead of trusting the incomplete entry
    expect(center.wind_direction).toBe(120);
  });

  it('averages directions as vectors: 350 and 10 degrees make north, not south', () => {
    const d = meanDirection([350, 10], [1, 1]);
    expect(Math.min(d, 360 - d)).toBeCloseTo(0, 6);
    expect(meanDirection([80, 100], [1, 1])).toBeCloseTo(90, 6);
    expect(meanDirection([0, 90], [3, 1])).toBeCloseTo((Math.atan2(1, 3) * 180) / Math.PI, 6);
  });

  it('interpolates across the 0/360 seam without swinging through 180', () => {
    const p = (wind_direction: number): BaselineData => ({ pm25: 10, pm10: 20, no2: 5, co: 100, o3: 30, wind_speed: 2, wind_direction });
    const f = buildInterpolator(0, 0, 1, 1, { center: p(0), nw: p(350), ne: p(10), sw: p(350), se: p(10) });
    const d = f(0.5, 0.5).wind_direction;
    expect(Math.min(d, 360 - d)).toBeLessThan(1);
    expect(f(0.5, 0.5).pm25).toBeCloseTo(10, 9);
  });

  it('reads the requested hour in forecast mode', async () => {
    const fetchImpl = (async (url: string) => {
      const hourly = url.includes('air-quality')
        ? { pm2_5: [1, 2, 3], pm10: [4, 5, 6], nitrogen_dioxide: [7, 8, 9], carbon_monoxide: [10, 11, 12], ozone: [13, 14, 15] }
        : { wind_speed_10m: [1, 2, 3], wind_direction_10m: [30, 60, 90] };
      expect(url).toContain('forecast_hours=3');
      return new Response(JSON.stringify({ hourly }));
    }) as unknown as typeof fetch;
    const [b] = await fetchBaselineBatch([-8.65], [115.21], 2, fetchImpl);
    expect(b).toMatchObject({ pm25: 3, no2: 9, wind_speed: 3, wind_direction: 90 });
  });
});
