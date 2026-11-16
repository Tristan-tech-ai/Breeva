import { describe, expect, it } from 'vitest';
import {
  aqiToConcentration, atLeastPm25, blendConcentrations, no2AqiToUg, pm10AqiToUg, pm25AqiToUg,
  PM25_BREAKPOINTS_2024, PM25_BREAKPOINTS_PRE2024,
} from '../api/vayu/_units';

describe('AQI to concentration', () => {
  it('maps the breakpoint ends of the PM2.5 table exactly', () => {
    expect(pm25AqiToUg(0)).toBe(0);
    expect(pm25AqiToUg(50)).toBeCloseTo(12, 6);
    expect(pm25AqiToUg(100)).toBeCloseTo(35.4, 6);
    expect(pm25AqiToUg(150)).toBeCloseTo(55.4, 6);
    expect(pm25AqiToUg(200)).toBeCloseTo(150.4, 6);
  });

  it('converts an AQI of 172 to about 96 µg/m³, not 172', () => {
    // 55.5 + (150.4 - 55.5) / (200 - 151) * (172 - 151)
    expect(pm25AqiToUg(172)).toBeCloseTo(96.17, 2);
  });

  it('uses the 2024 table only when asked', () => {
    expect(pm25AqiToUg(50, PM25_BREAKPOINTS_2024)).toBeCloseTo(9, 6);
    expect(pm25AqiToUg(50, PM25_BREAKPOINTS_PRE2024)).toBeCloseTo(12, 6);
  });

  it('rejects impossible input', () => {
    expect(aqiToConcentration(-1, PM25_BREAKPOINTS_PRE2024)).toBeNull();
    expect(aqiToConcentration(Number.NaN, PM25_BREAKPOINTS_PRE2024)).toBeNull();
  });

  it('converts NO2 and PM10 sub-indices', () => {
    expect(no2AqiToUg(50)).toBeCloseTo(53 * 1.88, 6);
    expect(pm10AqiToUg(100)).toBeCloseTo(154, 6);
  });
});

describe('blending', () => {
  it('blends a converted station value, never the raw AQI', () => {
    // Station reports AQI 120 for PM2.5 (about 43.2 µg/m³), model says 20 µg/m³.
    const station = pm25AqiToUg(120)!;
    const blended = blendConcentrations([
      { pm25: station, no2: null, weight: 0.5 },
      { pm25: 20, no2: 15, weight: 0.2 },
    ]);
    expect(station).toBeCloseTo(43.22, 2);
    expect(blended.pm25).toBeCloseTo((43.22 * 0.5 + 20 * 0.2) / 0.7, 1);
    // With the old bug the raw AQI 120 would have been blended: (120 * 0.5 + 20 * 0.2) / 0.7 = 91.4
    expect(blended.pm25!).toBeLessThan(40);
  });

  it('does not count a station without NO2 as NO2 = 0', () => {
    const blended = blendConcentrations([
      { pm25: 30, no2: null, weight: 0.5 },
      { pm25: 20, no2: 15, weight: 0.2 },
    ]);
    expect(blended.no2).toBe(15);
  });

  it('returns null when nothing contributes', () => {
    expect(blendConcentrations([])).toEqual({ pm25: null, no2: null });
  });
});

describe('physical guard', () => {
  it('never lets PM10 fall below PM2.5', () => {
    expect(atLeastPm25(49.7, 95.8)).toBe(95.8); // the live response of 14 Nov 2026
    expect(atLeastPm25(60, 40)).toBe(60);
  });
});
