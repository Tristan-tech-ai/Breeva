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
});
