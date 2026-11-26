import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { intervalSd } from '../scripts/field/kriging';
import { makeMeasuredAdjust } from '../scripts/field/engine';
import { hourlyValidation, looHour } from '../scripts/field/hourly-validation';
import type { MeasuredInputs, SensorReading } from '../scripts/field/measure';

const params = JSON.parse(readFileSync('scripts/field/params/measure.json', 'utf8')) as {
  regions: Record<string, { variogram_log: { nugget: number; sill: number; range_km: number }; pi_scale: number; noise_floor_ugm3?: number }>;
};
const bd = params.regions.badung_denpasar;

describe('sensor noise floor in the 95 % interval (F5-30)', () => {
  it('without a floor the sd is the widened kriging sd, as before', () => {
    expect(intervalSd(0.09, Math.log1p(20), 1.735, 0)).toBeCloseTo(0.3 * 1.735, 12);
    expect(intervalSd(0.09, Math.log1p(20))).toBeCloseTo(0.3, 12);
  });

  it('the floor is fixed in ug/m3, so it widens a clean hour much more than a smoky one', () => {
    const v = 0.04, k = 1.259;
    const clean = intervalSd(v, Math.log1p(8), k, 6) / intervalSd(v, Math.log1p(8), k, 0);
    const smoky = intervalSd(v, Math.log1p(80), k, 6) / intervalSd(v, Math.log1p(80), k, 0);
    expect(clean).toBeGreaterThan(2);
    expect(smoky).toBeLessThan(1.05);
    // in ug/m3 the half-width of a clean hour is at least the floor
    const m = Math.log1p(8), sd = intervalSd(v, m, k, 6);
    expect(Math.expm1(m + 1.96 * sd) - Math.expm1(m)).toBeGreaterThan(6);
  });

  it('the region carries the floor and the factor refitted with it, as a pair', () => {
    expect(bd.noise_floor_ugm3).toBe(6);
    expect(bd.pi_scale).toBeCloseTo(1.259, 3);
  });

  it('the field interval gains the floor and the estimate stays the same', () => {
    const sensors = [{ loc_id: 1, lat: -8.65, lon: 115.2, pm25: 8 }, { loc_id: 2, lat: -8.7, lon: 115.25, pm25: 10 }, { loc_id: 3, lat: -8.6, lon: 115.15, pm25: 9 }];
    const base = { method: 'kriging' as const, hour_utc: '', sensors_vetted: 3, note: '', sensors, variogram_log: bd.variogram_log, pi_scale: bd.pi_scale };
    const ev = { pm25: 9, pm25_delta: 1, pi95_hi: 20, ood_refused: false, confidence: 'high' as const };
    const without = makeMeasuredAdjust(base)!(-8.66, 115.21, ev);
    const withFloor = makeMeasuredAdjust({ ...base, noise_floor_ugm3: 6 })!(-8.66, 115.21, ev);
    expect(withFloor.pm25).toBe(without.pm25);
    expect(withFloor.pi95_hi - withFloor.pi95_lo).toBeGreaterThan(without.pi95_hi - without.pi95_lo + 5);
  });

  it('the hourly hidden-sensor test scores the interval the map publishes', () => {
    const grid: SensorReading[] = Array.from({ length: 12 }, (_, k) => ({ loc_id: k, lat: -8.65 + (k % 4) * 0.03, lon: 115.15 + Math.floor(k / 4) * 0.04, pm25: 6 + ((k * 7) % 11) }));
    const lo0 = looHour(grid, bd.variogram_log, bd.pi_scale, 0), lo6 = looHour(grid, bd.variogram_log, bd.pi_scale, 6);
    lo6.forEach((r, k) => { expect(r.pred).toBeCloseTo(lo0[k].pred, 9); expect(r.hi - r.lo).toBeGreaterThan(lo0[k].hi - lo0[k].lo); });
    const m = (floor?: number): MeasuredInputs => ({ method: 'kriging', hour_utc: '2026-11-22T04:00:00.000Z', sensor_hour_utc: '2026-11-22T04:00:00Z', sensors: grid, sensors_vetted: 28, variogram_log: bd.variogram_log, pi_scale: bd.pi_scale, ...(floor != null ? { noise_floor_ugm3: floor } : {}), note: '' });
    expect(hourlyValidation(m(6))!.pi95_coverage).toBeGreaterThanOrEqual(hourlyValidation(m())!.pi95_coverage);
    expect(hourlyValidation(m(0))!.pi95_coverage).toBe(hourlyValidation(m())!.pi95_coverage); // absent = 0
  });
});
