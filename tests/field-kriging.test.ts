import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OrdinaryKriging, distKm, fitVariogram, looPredict, pairStats } from '../scripts/field/kriging';

// Written by vayu/field/kriging_ref.py with the functions of the proposal's analysis H (numpy, scipy nnls).
const ref = JSON.parse(readFileSync('tests/fixtures/kriging_ref.json', 'utf8')) as {
  Y: Array<Array<number | null>>; dist: number[][]; G: Array<Array<number | null>>; W: number[][];
  variogram: [number, number, number]; loo: Array<{ variogram: [number, number, number]; pred: Array<number | null> }>;
};
const Y = ref.Y.map((c) => Float64Array.from(c, (x) => (x == null ? Number.NaN : x)));

describe('kriging port against the Python analysis', () => {
  it('pair semivariances and shared hours match', () => {
    const { G, W } = pairStats(Y);
    for (let i = 0; i < Y.length; i++) for (let j = 0; j < Y.length; j++) {
      expect(W[i][j]).toBe(ref.W[i][j]);
      const want = ref.G[i][j];
      if (want == null) expect(Number.isNaN(G[i][j])).toBe(true);
      else expect(G[i][j]).toBeCloseTo(want, 12);
    }
  });

  it('variogram fits match, all sensors and leave-one-out', () => {
    const { G, W } = pairStats(Y);
    const v = fitVariogram(G, W, ref.dist);
    expect(v.nugget).toBeCloseTo(ref.variogram[0], 9);
    expect(v.sill).toBeCloseTo(ref.variogram[1], 9);
    expect(v.range_km).toBeCloseTo(ref.variogram[2], 9);
    ref.loo.forEach((l, i) => {
      const vi = fitVariogram(G, W, ref.dist, i);
      expect([vi.nugget, vi.sill, vi.range_km].map((x) => Number(x.toFixed(9)))).toEqual(l.variogram.map((x) => Number(x.toFixed(9))));
    });
  });

  it('leave-one-out predictions match hour by hour', () => {
    const { G, W } = pairStats(Y);
    let compared = 0;
    ref.loo.forEach((l, i) => {
      const v = fitVariogram(G, W, ref.dist, i);
      const { mean } = looPredict(Y, ref.dist, i, v);
      l.pred.forEach((want, t) => {
        if (want == null) { expect(Number.isNaN(mean[t])).toBe(true); return; }
        expect(mean[t]).toBeCloseTo(want, 9);
        compared++;
      });
    });
    expect(compared).toBeGreaterThan(3000);
  });
});

describe('kriging properties', () => {
  const pts = [{ lat: -8.65, lon: 115.2 }, { lat: -8.7, lon: 115.25 }, { lat: -8.6, lon: 115.15 }, { lat: -8.68, lon: 115.12 }];
  const v = { nugget: 0.05, sill: 0.4, range_km: 10 };
  const vals = [3.1, 3.6, 2.9, 3.3];

  it('weights sum to one and the estimate stays inside the data range', () => {
    const ok = new OrdinaryKriging(pts, v);
    for (const [lat, lon] of [[-8.66, 115.21], [-8.9, 115.5], [-8.62, 115.13]]) {
      const dist = pts.map((p) => distKm(lat, lon, p.lat, p.lon));
      const { w } = ok.weightsFor(dist);
      expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
      const { mean, variance } = ok.predict(vals, lat, lon);
      expect(mean).toBeGreaterThanOrEqual(Math.min(...vals) - 0.5);
      expect(mean).toBeLessThanOrEqual(Math.max(...vals) + 0.5);
      expect(variance).toBeGreaterThan(0);
    }
  });

  it('without a nugget the estimate at a sensor is that sensor, with zero variance', () => {
    const ok = new OrdinaryKriging(pts, { ...v, nugget: 0 });
    const r = ok.predict(vals, pts[1].lat, pts[1].lon);
    expect(r.mean).toBeCloseTo(vals[1], 9);
    expect(r.variance).toBeCloseTo(0, 9);
    expect(r.nearest_km).toBe(0);
  });

  it('variance grows away from the sensors', () => {
    const ok = new OrdinaryKriging(pts, v);
    const near = ok.predict(vals, -8.651, 115.201).variance;
    const far = ok.predict(vals, -9.2, 115.9).variance;
    expect(far).toBeGreaterThan(near);
  });

  it('distance is close to the haversine distance at Bali latitude', () => {
    // Kuta to Ubud in a straight line, about 25.7 km by haversine.
    expect(distKm(-8.7184, 115.1686, -8.5069, 115.2625)).toBeGreaterThan(25);
    expect(distKm(-8.7184, 115.1686, -8.5069, 115.2625)).toBeLessThan(26.5);
  });
});
