import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hourlyValidation, looHour } from '../scripts/field/hourly-validation';
import type { MeasuredInputs, SensorReading } from '../scripts/field/measure';

const params = JSON.parse(readFileSync('scripts/field/params/measure.json', 'utf8')) as { regions: Record<string, { variogram_log: { nugget: number; sill: number; range_km: number }; pi_scale: number }> };
const v = params.regions.badung_denpasar.variogram_log;
const grid = (f: (k: number) => number): SensorReading[] =>
  Array.from({ length: 12 }, (_, k) => ({ loc_id: k, lat: -8.65 + (k % 4) * 0.03, lon: 115.15 + Math.floor(k / 4) * 0.04, pm25: f(k) }));
const kriged = (sensors: SensorReading[]): MeasuredInputs => ({
  method: 'kriging', hour_utc: '2026-11-16T10:00:00.000Z', sensor_hour_utc: '2026-11-16T09:00:00Z', sensors, sensors_vetted: 28,
  variogram_log: v, pi_scale: params.regions.badung_denpasar.pi_scale, note: '',
});

describe('hourly hidden-sensor validation', () => {
  it('a constant field is recovered exactly at every hidden sensor', () => {
    const r = hourlyValidation(kriged(grid(() => 20)))!;
    expect(r.n).toBe(12);
    expect(r.rmse).toBeCloseTo(0, 6);
    expect(r.bias).toBeCloseTo(0, 6);
    expect(r.pi95_coverage).toBe(1);
  });

  it('a hidden sensor never sees its own reading', () => {
    const base = grid((k) => 10 + 3 * k);
    const a = looHour(base, v)[5].pred;
    const changed = base.map((s, k) => (k === 5 ? { ...s, pm25: 400 } : s));
    expect(looHour(changed, v)[5].pred).toBeCloseTo(a, 9);
    expect(looHour(changed, v)[4].pred).not.toBeCloseTo(a, 3);
  });

  it('scores a gradient with the EPA statistics and refuses runs without kriging', () => {
    const r = hourlyValidation(kriged(grid((k) => 10 + 2 * (k % 4) + 3 * Math.floor(k / 4))))!;
    expect(r.n).toBe(12);
    expect(r.rmse).toBeGreaterThan(0);
    expect(r.nrmse).toBeCloseTo(r.rmse / r.mean_obs, 2);
    expect(r.r2).toBeGreaterThan(0.5);
    expect(r.scope).toMatch(/not the daily EPA target/);
    expect(hourlyValidation({ ...kriged(grid(() => 1)), method: 'koschmieder' })).toBeNull();
    expect(hourlyValidation(undefined)).toBeNull();
    expect(hourlyValidation(kriged(grid(() => 5).slice(0, 2)))).toBeNull();
  });
});
