/**
 * Unit conversions shared by the AQI endpoints.
 *
 * WAQI reports `iaqi.<pollutant>.v` as an individual US AQI sub-index, not a concentration
 * (https://aqicn.org/api/doc/). Every value taken from that feed must pass through these
 * functions before it is blended with concentrations from other sources.
 */

/** [aqiLo, aqiHi, concLo, concHi] rows of a US EPA breakpoint table. */
type Breakpoints = ReadonlyArray<readonly [number, number, number, number]>;

/** PM2.5 (µg/m³), US EPA table before the 2024 revision. WAQI and IQAir data in the archive were converted with it. */
export const PM25_BREAKPOINTS_PRE2024: Breakpoints = [
  [0, 50, 0, 12], [51, 100, 12.1, 35.4], [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 150.4], [201, 300, 150.5, 250.4], [301, 500, 250.5, 500.4],
];

/** PM2.5 (µg/m³), US EPA table effective 2024. */
export const PM25_BREAKPOINTS_2024: Breakpoints = [
  [0, 50, 0, 9], [51, 100, 9.1, 35.4], [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 125.4], [201, 300, 125.5, 225.4], [301, 500, 225.5, 325.4],
];

/** PM10 (µg/m³). */
export const PM10_BREAKPOINTS: Breakpoints = [
  [0, 50, 0, 54], [51, 100, 55, 154], [101, 150, 155, 254],
  [151, 200, 255, 354], [201, 300, 355, 424], [301, 500, 425, 604],
];

/** NO2 (ppb). */
export const NO2_BREAKPOINTS_PPB: Breakpoints = [
  [0, 50, 0, 53], [51, 100, 54, 100], [101, 150, 101, 360],
  [151, 200, 361, 649], [201, 300, 650, 1249], [301, 500, 1250, 2049],
];

/** O3 (ppb, 8-hour). */
export const O3_BREAKPOINTS_PPB: Breakpoints = [
  [0, 50, 0, 54], [51, 100, 55, 70], [101, 150, 71, 85], [151, 200, 86, 105], [201, 300, 106, 200],
];

/** ppb to µg/m³ at 25 °C and 1 atm. */
export const NO2_PPB_TO_UG = 1.88;
export const O3_PPB_TO_UG = 1.96;

/** Inverse of the piecewise-linear AQI formula. Non-finite or negative input returns null. */
export function aqiToConcentration(aqi: number, table: Breakpoints): number | null {
  if (!Number.isFinite(aqi) || aqi < 0) return null;
  for (const [aLo, aHi, cLo, cHi] of table) {
    if (aqi <= aHi) {
      const a = Math.max(aqi, aLo);
      return cLo + ((cHi - cLo) / (aHi - aLo)) * (a - aLo);
    }
  }
  return table[table.length - 1][3];
}

export function pm25AqiToUg(aqi: number, table: Breakpoints = PM25_BREAKPOINTS_PRE2024): number | null {
  return aqiToConcentration(aqi, table);
}

export function pm10AqiToUg(aqi: number): number | null {
  return aqiToConcentration(aqi, PM10_BREAKPOINTS);
}

export function no2AqiToUg(aqi: number): number | null {
  const ppb = aqiToConcentration(aqi, NO2_BREAKPOINTS_PPB);
  return ppb === null ? null : ppb * NO2_PPB_TO_UG;
}

export function o3AqiToUg(aqi: number): number | null {
  const ppb = aqiToConcentration(aqi, O3_BREAKPOINTS_PPB);
  return ppb === null ? null : ppb * O3_PPB_TO_UG;
}

export interface BlendInput {
  /** PM2.5 concentration in µg/m³ (never an AQI value). */
  pm25: number;
  /** NO2 concentration in µg/m³, or null when the source does not measure it. */
  no2: number | null;
  weight: number;
}

/**
 * Weighted blend of PM2.5 and NO2 concentrations. A source without NO2 contributes to the PM2.5
 * blend only; it is never counted as NO2 = 0. Returns null for a pollutant with no contributing source.
 */
export function blendConcentrations(inputs: readonly BlendInput[]): { pm25: number | null; no2: number | null } {
  let pmSum = 0, pmW = 0, noSum = 0, noW = 0;
  for (const s of inputs) {
    if (!(s.weight > 0) || !Number.isFinite(s.pm25)) continue;
    pmSum += s.pm25 * s.weight;
    pmW += s.weight;
    if (s.no2 !== null && Number.isFinite(s.no2)) {
      noSum += s.no2 * s.weight;
      noW += s.weight;
    }
  }
  return { pm25: pmW > 0 ? pmSum / pmW : null, no2: noW > 0 ? noSum / noW : null };
}
