import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, mergeRecent, summarizeRecent, type RecentEntry } from '../src/lib/field/validationRecent';

const e = (run: string, nrmse: number, n = 26): RecentEntry => ({ run, sensor_hour_utc: null, n, rmse: nrmse * 30, nrmse, bias: 0, r2: 0.5, pi95_coverage: 0.95 });
const now = new Date('2026-11-16T13:21:00Z');

describe('running hourly validation file', () => {
  it('adds entries oldest first and replaces a run that is built again', () => {
    let f = mergeRecent(null, 'badung_denpasar', e('2026111612', 0.36), now);
    f = mergeRecent(f, 'badung_denpasar', e('2026111614', 0.40), now);
    f = mergeRecent(f, 'badung_denpasar', e('2026111613', 0.30), now);
    f = mergeRecent(f, 'badung_denpasar', e('2026111613', 0.32), now);
    expect(f.entries.map((x) => [x.run, x.nrmse])).toEqual([['2026111612', 0.36], ['2026111613', 0.32], ['2026111614', 0.40]]);
    expect(f).toMatchObject({ format: 'validation_recent', name: 'badung_denpasar', updated_at: now.toISOString() });
    expect(Object.keys(f.entries[0]).sort()).toEqual(['bias', 'n', 'nrmse', 'pi95_coverage', 'r2', 'rmse', 'run', 'sensor_hour_utc']);
  });

  it('keeps only the last 72 hours', () => {
    let f = null;
    for (let h = 0; h < 80; h++) f = mergeRecent(f, 'r', e(`20261116${String(h).padStart(3, '0')}`, 0.3), now);
    expect(f!.entries).toHaveLength(MAX_ENTRIES);
    expect(f!.entries[0].run).toBe('20261116008');
  });

  it('summarises with medians, or nothing when empty', () => {
    const f = [0.3, 0.5, 0.4].reduce<ReturnType<typeof mergeRecent> | null>((acc, x, k) => mergeRecent(acc, 'r', e(`202611161${k}`, x, 20 + k), now), null);
    expect(summarizeRecent(f)).toEqual({ hours: 3, median_nrmse: 0.4, median_rmse: 12, median_coverage: 0.95, sensors_median: 21, last_run: '2026111612' });
    expect(summarizeRecent(null)).toBeNull();
  });

  it('counts each sensor hour once: the later run of the same OpenAQ hour stands for it (F5-27)', () => {
    const at = (run: string, hour: string | null, nrmse: number, n = 24): RecentEntry => ({ ...e(run, nrmse, n), sensor_hour_utc: hour });
    const f = { format: 'validation_recent' as const, name: 'r', scope: '', updated_at: '', entries: [
      at('2026111714', '2026-11-17T12:00:00Z', 0.30), at('2026111715', '2026-11-17T12:00:00Z', 0.90, 10), // same hour, later run wins
      at('2026111716', '2026-11-17T14:00:00Z', 0.40), at('2026111717', null, 0.50), at('2026111718', '2026-11-17T16:00:00Z', 0.60),
    ] };
    const s = summarizeRecent(f)!;
    expect(s.hours).toBe(4);
    expect(s.median_nrmse).toBe(0.55); // 0.40, 0.50, 0.60, 0.90
    expect(s.sensors_median).toBe(24);
    expect(s.last_run).toBe('2026111718');
  });
});

describe('daily EPA test from hourly hidden guesses', async () => {
  const { dailyEpa, localDate, mergeDaily, mergeRecent: merge } = await import('../src/lib/field/validationRecent');
  // 26 hours of 4 sensors around 17 Nov 2026 WITA (UTC+8): local day = 16 Nov 16:00Z .. 17 Nov 15:00Z
  const hour = (k: number) => new Date(Date.UTC(2026, 10, 16, 15 + k)).toISOString().replace('.000Z', 'Z');
  const rowsAt = (k: number, sensors = 4) => ({ sensor_hour_utc: hour(k), rows: Array.from({ length: sensors }, (_, s) => ({ loc_id: s, obs: 10 + 5 * s, pred: 10 + 5 * s + (s - 1.5) })) });
  const hours = Array.from({ length: 26 }, (_, k) => rowsAt(k));

  it('uses only the hours of the local day, once each, and sensors with at least 18 of them', () => {
    expect(localDate(Date.UTC(2026, 10, 16, 16), 8)).toBe('2026-11-17');
    expect(localDate(Date.UTC(2026, 10, 16, 15), 8)).toBe('2026-11-16');
    const d = dailyEpa([...hours, rowsAt(5)], '2026-11-17', 8)!; // the repeated hour is counted once
    expect(d).toMatchObject({ date: '2026-11-17', n: 4, hours_min: 24 });
    // predictions = obs + (s - 1.5): RMSE = sqrt(mean of 2.25, 0.25, 0.25, 2.25) = 1.118, mean obs 17.5
    expect(d.nrmse).toBeCloseTo(1.118 / 17.5, 3);
    expect(d.slope).toBeCloseTo(1.2, 3);
    expect(d.intercept).toBeCloseTo(-3.5, 2);
    expect(d.passes).toBe(4);
  });

  it('refuses a day with fewer than 3 sensors of 18 hours', () => {
    const short = Array.from({ length: 17 }, (_, k) => rowsAt(k + 1));
    expect(dailyEpa(short, '2026-11-17', 8)).toBeNull();
    expect(dailyEpa(hours.map((h) => ({ ...h, rows: h.rows.slice(0, 2) })), '2026-11-17', 8)).toBeNull();
  });

  it('keeps the daily list when hourly entries are added', () => {
    const now = new Date('2026-11-17T18:21:00Z');
    let f = merge(null, 'r', { run: '2026111718', sensor_hour_utc: null, n: 25, rmse: 10, nrmse: 0.35, bias: 0, r2: 0.5, pi95_coverage: 0.95 }, now);
    f = mergeDaily(f, dailyEpa(hours, '2026-11-17', 8)!);
    f = merge(f, 'r', { run: '2026111719', sensor_hour_utc: null, n: 25, rmse: 10, nrmse: 0.35, bias: 0, r2: 0.5, pi95_coverage: 0.95 }, now);
    expect(f.daily?.map((d) => d.date)).toEqual(['2026-11-17']);
    expect(f.entries).toHaveLength(2);
  });
});

describe('pooled daily test (F5-24)', async () => {
  const { dailyEpa, pooledDaily, epaFromSums } = await import('../src/lib/field/validationRecent');
  // one sensor hour per local hour of a day, sensors with a fixed reading and guess per day
  const dayRows = (date: string, sensors: Array<[number, number]>) => Array.from({ length: 20 }, (_, h) => ({
    sensor_hour_utc: new Date(Date.parse(`${date}T00:00:00Z`) - 8 * 3_600_000 + h * 3_600_000).toISOString(),
    rows: sensors.map(([o, p], k) => ({ loc_id: k + 1, obs: o, pred: p })),
  }));
  // two days with a small spread between sensors and different levels, as in the field (F5-24)
  const a: Array<[number, number]> = [[20, 24], [30, 26], [25, 29], [22, 23], [28, 24]];
  const b: Array<[number, number]> = [[50, 55], [55, 52], [52, 56], [58, 54]];

  it('the sums of a day give back that day\'s numbers', () => {
    const d = dailyEpa(dayRows('2026-11-17', a), '2026-11-17', 8)!;
    const m = epaFromSums(d.sums!);
    expect(m.n).toBe(5);
    expect(Number(m.nrmse.toFixed(3))).toBe(d.nrmse);
    expect(Number(m.r2.toFixed(3))).toBe(d.r2);
    expect(Number(m.slope.toFixed(3))).toBe(d.slope);
    expect(Number(m.intercept.toFixed(2))).toBe(d.intercept);
    expect(m.passes).toBe(d.passes);
  });

  it('pooling two days equals one test over all their sensor-days, and days without sums are left out', () => {
    const d1 = dailyEpa(dayRows('2026-11-17', a), '2026-11-17', 8)!;
    const d2 = dailyEpa(dayRows('2026-11-18', b), '2026-11-18', 8)!;
    const old = { ...d1, date: '2026-11-16', sums: undefined };
    const p = pooledDaily([d2, old, d1])!;
    const all = [...a, ...b];
    // the same pairs as one "day" of 9 sensors
    const one = dailyEpa(dayRows('2026-11-20', all), '2026-11-20', 8)!;
    expect(p.days).toBe(2);
    expect([p.from, p.to]).toEqual(['2026-11-17', '2026-11-18']);
    expect(p.n).toBe(9);
    expect(Number(p.nrmse.toFixed(3))).toBe(one.nrmse);
    expect(Number(p.r2.toFixed(3))).toBe(one.r2);
    expect(Number(p.slope.toFixed(3))).toBe(one.slope);
    expect(Number(p.intercept.toFixed(2))).toBe(one.intercept);
    // across days the readings spread far more than within one, so R2 is higher pooled than on either day
    expect(p.r2).toBeGreaterThan(Math.max(d1.r2, d2.r2));
    expect(pooledDaily([old])).toBeNull();
    expect(pooledDaily(undefined)).toBeNull();
  });
});
