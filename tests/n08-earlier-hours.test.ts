import { describe, expect, it } from 'vitest';
import { earlierHours, measureHour, type RegionMeasureParams } from '../scripts/field/measure';
import { earlierRows, hourlyRows } from '../scripts/field/hourly-validation';
import { dailyEpa, dayHours, type HourRows } from '../src/lib/field/validationRecent';

const hour = new Date('2026-11-16T07:00:00Z');
const sensors = [
  { loc_id: 1, sensor_id: 11, name: 'a', lat: -8.65, lon: 115.2 },
  { loc_id: 2, sensor_id: 12, name: 'b', lat: -8.7, lon: 115.25 },
  { loc_id: 3, sensor_id: 13, name: 'c', lat: -8.6, lon: 115.15 },
  { loc_id: 4, sensor_id: 14, name: 'd', lat: -8.68, lon: 115.12 },
];
const params: RegionMeasureParams = { network: 'openaq', min_sensors: 3, sensors, variogram_log: { nugget: 0.05, sill: 0.4, range_km: 20 } };

function fakeFetch(values: Record<number, Record<string, number>>) {
  return async (url: string) => {
    const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body, text: async () => '', headers: { get: () => null } });
    const m = url.match(/sensors\/(\d+)\/hours/);
    const v = m ? values[Number(m[1])] ?? {} : {};
    return ok({ results: Object.entries(v).map(([h, x]) => ({ value: x, period: { datetimeFrom: { utc: `2026-11-16T${h}:00:00Z` } } })) });
  };
}

const r = (s: number) => ({ loc_id: s, sensor_id: s, name: String(s), lat: -8.6 - s / 100, lon: 115.2 + s / 100, pm25: 10 * s });

describe('N-08 older sensor hours of the same request', () => {
  it('keeps at most 2 hours before the chosen one that enough sensors reported, newest first', () => {
    const by = new Map([
      ['2026-11-16T07:00:00Z', [r(1), r(2), r(3)]],
      ['2026-11-16T06:00:00Z', [r(1), r(2), r(3)]],
      ['2026-11-16T05:00:00Z', [r(1), r(2)]], // too few
      ['2026-11-16T04:00:00Z', [r(1), r(2), r(3)]],
      ['2026-11-16T03:00:00Z', [r(1), r(2), r(3)]], // 4 h back: too old
    ]);
    expect(earlierHours(by, '2026-11-16T07:00:00Z', 3).map((e) => e.sensor_hour_utc)).toEqual(['2026-11-16T06:00:00Z']);
    expect(earlierHours(by, '2026-11-16T06:00:00Z', 3).map((e) => e.sensor_hour_utc)).toEqual(['2026-11-16T04:00:00Z']);
  });

  it('measureHour carries the older hours, and they never change the map hour', async () => {
    const m = await measureHour(params, hour, { openaqKey: 'k' }, {
      fetchImpl: fakeFetch({ 11: { '05': 10, '06': 11, '07': 12 }, 12: { '05': 20, '06': 21, '07': 22 }, 13: { '05': 30, '06': 31, '07': 32 }, 14: { '06': 41 } }),
    });
    expect(m.sensor_hour_utc).toBe('2026-11-16T07:00:00Z');
    expect(m.sensors.map((s) => s.pm25)).toEqual([12, 22, 32]);
    expect(m.earlier?.map((e) => [e.sensor_hour_utc, e.sensors.length])).toEqual([['2026-11-16T06:00:00Z', 4], ['2026-11-16T05:00:00Z', 3]]);
    const rows = earlierRows(m);
    expect(rows.map((x) => x.sensor_hour_utc)).toEqual(['2026-11-16T05:00:00Z', '2026-11-16T06:00:00Z']);
    expect(rows[1].rows).toHaveLength(4);
    expect(hourlyRows(m)?.sensor_hour_utc).toBe('2026-11-16T07:00:00Z');
  });

  it('a day where OpenAQ lagged gets its skipped hours back, and a run’s own hour wins over a carried copy', () => {
    const rowsAt = (h: number, pred = 20): HourRows => ({
      sensor_hour_utc: new Date(Date.UTC(2026, 10, 16, h - 8)).toISOString().replace('.000Z', 'Z'),
      rows: [1, 2, 3].map((s) => ({ loc_id: s, obs: 10 * s, pred: pred + s })),
    });
    // 24 local hours (WITA, tz 8); the runs kriged only the even hours, each carried the hour before
    const reps = Array.from({ length: 12 }, (_, i) => ({ validation_rows: rowsAt(2 * i), validation_rows_earlier: i > 0 ? [rowsAt(2 * i - 1), rowsAt(2 * i - 2, 999)] : [] }));
    reps.push({ validation_rows: rowsAt(24), validation_rows_earlier: [rowsAt(23)] }); // next day 00:00 carries 23:00
    const without = dailyEpa(reps.map((x) => x.validation_rows), '2026-11-16', 8);
    expect(without).toBeNull(); // 12 hours < 18
    const hours = dayHours(reps);
    const d = dailyEpa(hours, '2026-11-16', 8)!;
    expect(d.hours_min).toBe(24);
    // the carried copies with pred 999 never replaced the run's own rows of the same hour
    expect(d.slope).toBeLessThan(5);
  });
});
