import { describe, expect, it } from 'vitest';
import { koschmiederPm25, parseIemCsv, summariseHour } from '../scripts/field/smoke';

const csv = `station,valid,lon,lat,vsby,relh,wxcodes
WADD,2026-11-16 08:30,115.1672,-8.7482,6.21,84.04,M
WADD,2026-11-16 08:00,115.1672,-8.7482,6.21,84.04,TS
WIPP,2026-10-02 03:00,104.70,-2.90,0.62,70.00,FU
WIPP,2026-10-02 03:30,104.70,-2.90,0.93,70.00,FU HZ
WIHH,2026-11-16 08:30,106.8911,-6.2666,3.11,63.01,HZ
WIHH,2026-11-16 08:00,106.8911,-6.2666,1.24,60.00,HZ
WIII,2026-11-16 08:00,106.65,-6.12,1.24,90.00,BR
WIII,2026-11-16 08:30,106.65,-6.12,M,M,M`;

describe('IEM METAR parsing', () => {
  it('reads values, missing markers and weather codes', () => {
    const r = parseIemCsv(csv);
    expect(r).toHaveLength(8);
    expect(r[0]).toEqual({ station: 'WADD', valid: '2026-11-16T08:30', vsby_mi: 6.21, relh: 84.04, wxcodes: '' });
    expect(r[3].wxcodes).toBe('FU HZ');
    expect(r[7].vsby_mi).toBeNull();
  });
});

describe('Koschmieder smoke rule', () => {
  const reports = parseIemCsv(csv);

  it('a clear wet hour at the 10 km cap does not fire', () => {
    const h = summariseHour(reports, 'WADD', '2026-11-16T08:00:00Z');
    expect(h.reports).toBe(2);
    expect(h.below_10km).toBe(0);
    expect(h.wet).toBe(true);
    expect(koschmiederPm25(h, 6.18)).toBeNull();
  });

  it('reported smoke fires, with the extinction formula of analysis F', () => {
    const h = summariseHour(reports, 'WIPP', '2026-10-02T03:00:00Z');
    expect(h.smoke).toBe(true);
    // b = 3.912 / V(km); b_dry = b * (1 - 0.70)^0.6; mean of the two reports; PM = b_dry / (alpha / 1000)
    const bd = (v: number) => (3.912 / (v * 1.609344)) * 0.3 ** 0.6;
    const want = ((bd(0.62) + bd(0.93)) / 2) / (6.36 / 1000);
    const r = koschmiederPm25(h, 6.36)!;
    expect(r.reason).toBe('smoke');
    expect(r.pm25).toBeCloseTo(want, 9);
    expect(r.pm25).toBeGreaterThan(150);
  });

  it('dry haze under 3 km fires as low visibility; mist or fog does not', () => {
    const h = summariseHour(reports, 'WIHH', '2026-11-16T08:00:00Z');
    expect(h.vkm!).toBeCloseTo((3.11 * 1.609344 + 1.24 * 1.609344) / 2, 9);
    expect(h.vkm!).toBeLessThan(3.6);
    // mean visibility 3.5 km is above 3 km: no fire
    expect(koschmiederPm25(h, 6.61)).toBeNull();
    const low = summariseHour(reports.filter((r) => r.vsby_mi !== 3.11), 'WIHH', '2026-11-16T08:00:00Z');
    expect(koschmiederPm25(low, 6.61)?.reason).toBe('low_visibility');
    const mist = summariseHour(reports, 'WIII', '2026-11-16T08:00:00Z');
    expect(mist.fog).toBe(true);
    expect(koschmiederPm25(mist, 6.61)).toBeNull();
  });

  it('an hour without reports gives nothing', () => {
    expect(koschmiederPm25(summariseHour(reports, 'WADD', '2026-11-16T03:00:00Z'), 6.18)).toBeNull();
  });
});
