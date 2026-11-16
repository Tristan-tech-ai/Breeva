import { describe, expect, it } from 'vitest';
import {
  CUTOFF_M, EMISSION_G_PER_KM, exhaustAt, initialSigmaZ, isMajor, lineKernel, mixingHalfWidth, urbanSigmaZ,
  type ExhaustSource, type Stability,
} from '../src/lib/field/exhaust';

/** A straight north-south road of the given length, seen from a receptor d metres to its east. */
function straight(d: number, lengthM = 4000, pieceM = 40): Float64Array {
  const n = Math.round(lengthM / pieceM);
  const xy = new Float64Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) { xy[2 * i] = -d; xy[2 * i + 1] = -lengthM / 2 + i * pieceM; }
  return xy;
}
const HALF_W = mixingHalfWidth(7); // two-lane road: 3.5 + 3 m

describe('dispersion formulas from the primary sources', () => {
  it('Briggs urban sigma_z (ISC3 vol. II table 1-4) at 100 m', () => {
    expect(urbanSigmaZ(100, 'A')).toBeCloseTo(0.24 * 100 * Math.sqrt(1.1), 6);
    expect(urbanSigmaZ(100, 'B')).toBe(urbanSigmaZ(100, 'A'));
    expect(urbanSigmaZ(100, 'C')).toBeCloseTo(20, 6);
    expect(urbanSigmaZ(100, 'D')).toBeCloseTo(14 / Math.sqrt(1.03), 6);
    expect(urbanSigmaZ(100, 'E')).toBeCloseTo(8 / Math.sqrt(1.15), 6);
    expect(urbanSigmaZ(100, 'F')).toBe(urbanSigmaZ(100, 'E')); // E and F share one urban formula
    expect(urbanSigmaZ(0, 'D')).toBe(0);
  });

  it('mixing zone: travelled way plus 3 m each side; SGZ1 = 1.8 + 0.11 TR, hourly average', () => {
    expect(mixingHalfWidth(7)).toBe(6.5);
    expect(mixingHalfWidth(null)).toBe(5);
    // W2 = 10 m, u = 2 m/s: TR = 5 s, SGZ1 = 2.35 m, times (60/30)^0.2
    expect(initialSigmaZ(10, 2)).toBeCloseTo(2.35 * Math.pow(2, 0.2), 6);
    // a calm hour is treated as 0.5 m/s
    expect(initialSigmaZ(10, 0)).toBe(initialSigmaZ(10, 0.5));
  });

  it('road classes: tertiary and above are major', () => {
    expect(isMajor('tertiary') && isMajor('trunk_link') && !isMajor('residential') && !isMajor('service')).toBe(true);
  });
});

describe('exhaust kernel of a straight road', () => {
  it('falls with distance from the road in every stability class', () => {
    for (const s of ['B', 'C', 'D', 'F'] as Stability[]) {
      const c = [0, 10, 25, 50, 100, 150, 300].map((d) => lineKernel(straight(d), 2, s, HALF_W));
      for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThan(c[i - 1]);
    }
  });

  it('gradient gate: at least a 50% decrease from the road edge by 150 m (Karner et al. 2010, exhaust tracers)', () => {
    for (const [s, u] of [['B', 2], ['D', 2], ['D', 4], ['F', 1]] as Array<[Stability, number]>) {
      const edge = lineKernel(straight(HALF_W), u, s, HALF_W);
      const far = lineKernel(straight(HALF_W + 150), u, s, HALF_W);
      expect(far / edge).toBeLessThan(0.5);
      expect(far).toBeGreaterThan(0); // not cut to nothing either
    }
  });

  it('is uniform inside the mixing zone and nothing beyond the cut-off', () => {
    expect(lineKernel(straight(0), 2, 'D', HALF_W)).toBeCloseTo(lineKernel(straight(HALF_W * 0.6), 2, 'D', HALF_W), 1);
    expect(lineKernel(straight(CUTOFF_M + 50), 2, 'D', HALF_W)).toBe(0);
  });

  it('does not depend on how the road is cut into pieces (numerical convergence within 2%)', () => {
    for (const d of [0, 20, 120]) {
      const a = lineKernel(straight(d, 4000, 400), 2, 'D', HALF_W), b = lineKernel(straight(d, 4000, 10), 2, 'D', HALF_W);
      expect(Math.abs(a / b - 1)).toBeLessThan(0.02);
    }
  });

  it('more wind dilutes; the same road gives the same value on both sides', () => {
    expect(lineKernel(straight(30), 4, 'D', HALF_W)).toBeLessThan(lineKernel(straight(30), 2, 'D', HALF_W));
    expect(lineKernel(straight(-30), 2, 'D', HALF_W)).toBeCloseTo(lineKernel(straight(30), 2, 'D', HALF_W), 9);
  });

  it('kerbside magnitude: 2,250 vehicles/hour at 2 m/s neutral gives tens of ug/m3 of NOx, not units or thousands', () => {
    const q = (2250 * EMISSION_G_PER_KM.nox * 1e6) / 3600 / 1000; // ug/m/s
    const c = lineKernel(straight(0), 2, 'D', mixingHalfWidth(14)) * q;
    expect(c).toBeGreaterThan(30);
    expect(c).toBeLessThan(300);
  });
});

describe('exhaustAt: many roads, many receptors', () => {
  const lat0 = -8.67, lon0 = 115.21, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const road = (dxM: number, veh: number, major: boolean, lengthM = 2000): ExhaustSource => ({
    coords: [[lon0 + dxM / mLon, lat0 - lengthM / 2 / 110574], [lon0 + dxM / mLon, lat0 + lengthM / 2 / 110574]],
    vehPerHour: veh, mod: 1, halfW: 6.5, major,
  });
  const met = () => ({ wind: 2, stability: 'D' as Stability });
  const at = (dxM: number) => ({ lat: lat0, lon: lon0 + dxM / mLon });

  it('a major road 200 m away is counted even when 60 small streets are nearer', () => {
    const lanes = Array.from({ length: 60 }, (_, k) => road(-30 + k, 5, false, 60));
    const withTrunk = exhaustAt([...lanes, road(200, 2500, true)], [at(0)], met)[0];
    const without = exhaustAt(lanes, [at(0)], met)[0];
    expect(withTrunk.nox).toBeGreaterThan(without.nox * 1.5);
  });

  it('NOx and primary PM2.5 keep the ratio of their emission factors; no traffic, no exhaust', () => {
    const [v] = exhaustAt([road(0, 1000, true)], [at(10)], met);
    expect(v.pm25 / v.nox).toBeCloseTo(EMISSION_G_PER_KM.pm25 / EMISSION_G_PER_KM.nox, 9);
    expect(exhaustAt([road(0, 0, true)], [at(10)], met)[0].nox).toBe(0);
  });

  it('walking on the busy road breathes several times more exhaust than a lane 150 m away', () => {
    const src = [road(0, 2000, true), road(150, 20, false)];
    const [onRoad, lane] = exhaustAt(src, [at(0), at(150)], met);
    expect(onRoad.nox / lane.nox).toBeGreaterThan(3);
  });
});

describe('exhaust sources of a road pack', async () => {
  const { readFileSync } = await import('node:fs');
  const { RoadPack } = await import('../scripts/field/pack');
  const { CLASS_FACTOR, exhaustSources, roadRow } = await import('../scripts/field/engine');
  const pack = new RoadPack(new Uint8Array(readFileSync('tests/fixtures/pack_small.bin')));
  // pack_small: road 0 is a primary road near (-8.64992, 115.16655), road 1 a service road near (-8.65212, 115.17614)
  const rows = Array.from({ length: pack.n }, (_, k) => roadRow(pack, k));

  it('vehicles per hour follow the class estimate, the hour curve, the class factor and live congestion', () => {
    const quiet = exhaustSources(rows, (k) => pack.coords(k), 0.5);
    const rush = exhaustSources(rows, (k) => pack.coords(k), 1.5, { 0: 1.4 });
    expect(rush[0].vehPerHour / quiet[0].vehPerHour).toBeCloseTo(3 * 1.4, 9);
    expect(rush[1].vehPerHour / quiet[1].vehPerHour).toBeCloseTo(3, 9);
    expect(quiet[0].major).toBe(true);
    expect(quiet[1].major).toBe(false);
    expect(quiet[0].vehPerHour).toBeGreaterThan(quiet[1].vehPerHour * 5);
  });

  it('a road without a classified factor takes its class median, the same for every road of the class', () => {
    const bare = rows.map((r) => ({ ...r, ai_pollution_factor: null }));
    const src = exhaustSources(bare, (k) => pack.coords(k), 1);
    expect(src[0].vehPerHour).toBeCloseTo((bare[0].traffic_base_estimate || 100) * CLASS_FACTOR.primary, 9);
    expect(src[1].vehPerHour).toBeCloseTo((bare[1].traffic_base_estimate || 100) * CLASS_FACTOR.service, 9);
  });

  it('standing on the primary road gives far more exhaust than standing on the service road', () => {
    const src = exhaustSources(rows, (k) => pack.coords(k), 1);
    const mids = [0, 1].map((k) => { const c = pack.coords(k); const m = c[Math.floor(c.length / 2)]; return { lat: m[1], lon: m[0] }; });
    const [primary, service] = exhaustAt(src, mids, () => ({ wind: 2, stability: 'D' as Stability }));
    expect(primary.nox).toBeGreaterThan(service.nox * 5);
  });
});
