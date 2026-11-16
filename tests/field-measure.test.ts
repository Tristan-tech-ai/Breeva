import { describe, expect, it } from 'vitest';
import { measureHour, type RegionMeasureParams } from '../scripts/field/measure';
import { makeMeasuredAdjust } from '../scripts/field/engine';

const hour = new Date('2026-11-16T07:00:00Z');
const sensors = [
  { loc_id: 1, sensor_id: 11, name: 'a', lat: -8.65, lon: 115.2 },
  { loc_id: 2, sensor_id: 12, name: 'b', lat: -8.7, lon: 115.25 },
  { loc_id: 3, sensor_id: 13, name: 'c', lat: -8.6, lon: 115.15 },
  { loc_id: 4, sensor_id: 14, name: 'd', lat: -8.68, lon: 115.12 },
];
const params: RegionMeasureParams = {
  network: 'openaq', min_sensors: 3, sensors, metar: 'WADD', alpha_m2g: 6.18,
  variogram_log: { nugget: 0.05, sill: 0.4, range_km: 20 },
};

/** values[sensor] = value at 07:00 UTC, or { hour: value } for several hours. */
function fakeFetch(values: Record<number, number | null | Record<string, number>>, metarCsv: string, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    const ok = (body: unknown, text = '') => ({ status: 200, ok: true, json: async () => body, text: async () => text, headers: { get: () => null } });
    const m = url.match(/sensors\/(\d+)\/hours/);
    if (m) {
      const v = values[Number(m[1])];
      const hours = v == null ? {} : typeof v === 'number' ? { '07': v } : v;
      return ok({ results: Object.entries(hours).map(([h, x]) => ({ value: x, period: { datetimeFrom: { utc: `2026-11-16T${h}:00:00Z` } } })) });
    }
    return ok(null, metarCsv);
  };
}

const clearMetar = 'station,valid,lon,lat,vsby,relh,wxcodes\nWADD,2026-11-16 07:00,115.16,-8.74,6.21,80,M\n';
const smokyMetar = 'station,valid,lon,lat,vsby,relh,wxcodes\nWADD,2026-11-16 07:00,115.16,-8.74,0.62,70,FU\n';

describe('measurement layer choice', () => {
  it('krige when enough vetted sensors report, asking OpenAQ for exactly that hour', async () => {
    const calls: string[] = [];
    const m = await measureHour(params, hour, { openaqKey: 'k' }, { fetchImpl: fakeFetch({ 11: 20, 12: 30, 13: 25, 14: 5000 }, clearMetar, calls) });
    expect(m.method).toBe('kriging');
    expect(m.sensors.map((s) => s.loc_id)).toEqual([1, 2, 3]); // 5000 ug/m3 is dropped
    expect(calls[0]).toContain('datetime_from=2026-11-16T04:00:00Z&datetime_to=2026-11-16T08:00:00Z');
    expect(m.sensor_hour_utc).toBe('2026-11-16T07:00:00Z');
  });

  it('take the newest hour that enough sensors reported, never a mix of hours', async () => {
    const m = await measureHour(params, hour, { openaqKey: 'k' }, {
      fetchImpl: fakeFetch({ 11: { '05': 10, '06': 11, '07': 90 }, 12: { '05': 20, '06': 21 }, 13: { '05': 30, '06': 31 }, 14: { '05': 40 } }, clearMetar),
    });
    expect(m.method).toBe('kriging');
    expect(m.sensor_hour_utc).toBe('2026-11-16T06:00:00Z');
    expect(m.sensors.map((s) => s.pm25)).toEqual([11, 21, 31]);
    expect(m.note).toContain('1 h before the field hour');
  });

  it('fall back to the smoke rule when too few sensors report and the airport is smoky', async () => {
    const m = await measureHour(params, hour, { openaqKey: 'k' }, { fetchImpl: fakeFetch({ 11: 20, 12: null, 13: null, 14: null }, smokyMetar) });
    expect(m.method).toBe('koschmieder');
    expect(m.koschmieder!.reason).toBe('smoke');
    expect(m.koschmieder!.pm25).toBeGreaterThan(100);
  });

  it('use nothing when there is no key and the airport is clear, and say why', async () => {
    const m = await measureHour(params, hour, {}, { fetchImpl: fakeFetch({}, clearMetar) });
    expect(m.method).toBe('none');
    expect(m.note).toContain('OPENAQ_API_KEY not set');
    expect(m.note).toContain('no smoke');
  });

  it('a region without parameters gets no measurement', async () => {
    expect((await measureHour(undefined, hour, {})).method).toBe('none');
  });
});

describe('measured ambient in the field', () => {
  const engineValue = { pm25: 18, pm25_delta: 3, pi95_hi: 50, ood_refused: false, confidence: 'high' as const };

  it('kriging replaces the ambient and keeps the road increment', () => {
    const adjust = makeMeasuredAdjust({
      method: 'kriging', hour_utc: hour.toISOString(), sensors_vetted: 3, note: '',
      sensors: [{ loc_id: 1, lat: -8.65, lon: 115.2, pm25: 40 }, { loc_id: 2, lat: -8.7, lon: 115.25, pm25: 40 }, { loc_id: 3, lat: -8.6, lon: 115.15, pm25: 40 }],
      variogram_log: { nugget: 0, sill: 0.4, range_km: 20 },
    })!;
    const at = adjust(-8.65, 115.2, engineValue);
    expect(at.pm25).toBeCloseTo(43, 6); // all sensors read 40: ambient 40 + increment 3
    expect(at.confidence).toBe('high');
    expect(at.pi95_lo).toBeLessThanOrEqual(at.pm25);
    expect(at.pi95_hi).toBeGreaterThanOrEqual(at.pm25);
    const far = adjust(-8.9, 115.6, engineValue);
    expect(far.confidence).toBe('medium');
    expect(far.pi95_hi - far.pi95_lo).toBeGreaterThan(at.pi95_hi - at.pi95_lo);
  });

  it('the smoke rule only ever raises the value, with low confidence', () => {
    const adjust = makeMeasuredAdjust({
      method: 'koschmieder', hour_utc: hour.toISOString(), sensors: [], sensors_vetted: 0, note: '',
      koschmieder: { pm25: 120, reason: 'smoke', alpha_m2g: 6.2 },
    })!;
    const r = adjust(-6.6, 106.8, engineValue);
    expect(r.pm25).toBe(123);
    expect(r.confidence).toBe('low');
    expect(r.pi95_hi - r.pm25).toBeCloseTo(32, 6);
    const low = makeMeasuredAdjust({ method: 'koschmieder', hour_utc: '', sensors: [], sensors_vetted: 0, note: '', koschmieder: { pm25: 2, reason: 'low_visibility', alpha_m2g: 6.2 } })!;
    expect(low(-6.6, 106.8, engineValue).pm25).toBe(18);
  });

  it('no measurement leaves the engine value alone', () => {
    expect(makeMeasuredAdjust(undefined)).toBeNull();
    expect(makeMeasuredAdjust({ method: 'none', hour_utc: '', sensors: [], sensors_vetted: 0, note: '' })).toBeNull();
  });
});
