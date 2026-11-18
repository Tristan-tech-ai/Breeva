// Road colors and widths shared by the road layers (PostGIS MVT and the static field), so both draw the same.

export const TOTAL_STOPS: Record<string, [number, string][]> = {
  aqi:  [[0, '#00E400'], [50, '#FFFF00'], [100, '#FF7E00'], [150, '#FF0000'], [200, '#8F3F97'], [300, '#7E0023']],
  pm25: [[0, '#00E400'], [12, '#FFFF00'], [35.4, '#FF7E00'], [55.4, '#FF0000'], [150.4, '#8F3F97'], [250.4, '#7E0023']],
  no2:  [[0, '#00E400'], [40, '#FFFF00'], [100, '#FF7E00'], [200, '#FF0000'], [400, '#8F3F97'], [1000, '#7E0023']],
  o3:   [[0, '#00E400'], [60, '#FFFF00'], [100, '#FF7E00'], [140, '#FF0000'], [240, '#8F3F97'], [380, '#7E0023']],
  pm10: [[0, '#00E400'], [54, '#FFFF00'], [154, '#FF7E00'], [254, '#FF0000'], [354, '#8F3F97'], [424, '#7E0023']],
};
/**
 * Exhaust view ("asap kendaraan"): the part of a road's value that comes from the traffic on it and around it
 * (pm25_delta, no2_delta), on a FIXED ug/m3 scale. The default tracer is traffic NOx (the no2_delta column): it spans
 * two orders of magnitude between a lane and a trunk road, so its steps are roughly geometric and its dead band is
 * low. For PM2.5 mass the dead band stays at 1 ug/m3: a few tenths of a microgram are far below what the field
 * resolves. The scale never stretches to the roads on screen, so one value has one colour everywhere. Violet, not the
 * health colours, so the view is not read as a health category.
 */
export const TRAFFIC_DEADBAND: Record<'pm25' | 'no2' | 'pm10', number> = { pm25: 1, no2: 2, pm10: 2 };
export const TRAFFIC_GREY = '#d1d5db';
/**
 * Roads with practically no exhaust in the NOx view: a calm teal, so a clean lane reads as "clean" and not as a road
 * whose value has not loaded (those are grey). Not a health colour either.
 */
export const TRAFFIC_CLEAN = '#5eead4';
export const TRAFFIC_STOPS: Record<'pm25' | 'no2' | 'pm10', [number, string][]> = {
  pm25: [[1, '#e9d5ff'], [2, '#c084fc'], [4, '#9333ea'], [8, '#581c87']],
  no2: [[2, '#ddd6fe'], [5, '#c4b5fd'], [15, '#8b5cf6'], [40, '#6d28d9'], [100, '#3b0764']],
  pm10: [[2, '#e9d5ff'], [4, '#c084fc'], [8, '#9333ea'], [16, '#581c87']],
};

/** Pollutant the traffic view shows: PM2.5, NO2 or PM10 as chosen; NO2 (the exhaust tracer) for the index and O3. */
export function trafficPollutant(p: string): 'pm25' | 'no2' | 'pm10' {
  return p === 'pm25' || p === 'pm10' ? p : 'no2';
}

export function trafficColor(pollutant: string, delta: number): string {
  const p = trafficPollutant(pollutant);
  if (!Number.isFinite(delta)) return TRAFFIC_GREY;
  if (!(delta >= TRAFFIC_DEADBAND[p])) return p === 'no2' ? TRAFFIC_CLEAN : TRAFFIC_GREY;
  return lerpColor(TRAFFIC_STOPS[p], delta);
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Linear interpolation along a color ramp. */
export function lerpColor(stops: [number, string][], v: number): string {
  if (!Number.isFinite(v) || v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }
  }
  return stops[stops.length - 1][1];
}

const MAJOR = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);
const PRIMARY = new Set(['primary', 'primary_link', 'secondary', 'secondary_link']);
/** Width by class, scaled with zoom: z12 thin, z16 thick, grows past 16. */
/** A lane or residential street (not a major or primary road): most of a town's network. */
export function isMinorRoad(highway: string): boolean {
  return !MAJOR.has(highway) && !PRIMARY.has(highway);
}

// F1-70: lanes stay thin until the user zooms in, so at z15 the town is not a mesh of colour (Tristan, 18 Nov 2026)
const MINOR_STOPS: Array<[number, number]> = [[13, 0.4], [14, 0.5], [15, 0.9], [16, 1.4], [17, 2.0], [18, 2.4], [19, 2.6]];

export function weightFor(highway: string, zoom: number): number {
  if (isMinorRoad(highway)) {
    if (zoom <= MINOR_STOPS[0][0]) return MINOR_STOPS[0][1];
    for (let i = 1; i < MINOR_STOPS.length; i++) {
      const [z1, w1] = MINOR_STOPS[i];
      const [z0, w0] = MINOR_STOPS[i - 1];
      if (zoom <= z1) return w0 + ((w1 - w0) * (zoom - z0)) / (z1 - z0);
    }
    return MINOR_STOPS[MINOR_STOPS.length - 1][1];
  }
  const t = Math.max(0, (zoom - 12) / 4);
  const lo = MAJOR.has(highway) ? 1.6 : 1.1;
  const hi = MAJOR.has(highway) ? 6 : 4;
  return lo + (hi - lo) * Math.min(t, 1.75);
}

/** Line opacity of a coloured road: lanes are quieter below z16 so the main roads read first. */
export function opacityFor(highway: string, zoom: number, base: number): number {
  return isMinorRoad(highway) && zoom < 16 ? Math.min(base, 0.6) : base;
}

export function aqiBand(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Baik', color: '#00E400' };
  if (aqi <= 100) return { label: 'Sedang', color: '#d9b500' };
  if (aqi <= 150) return { label: 'Tidak sehat (sensitif)', color: '#FF7E00' };
  if (aqi <= 200) return { label: 'Tidak sehat', color: '#FF0000' };
  if (aqi <= 300) return { label: 'Sangat tidak sehat', color: '#8F3F97' };
  return { label: 'Berbahaya', color: '#7E0023' };
}

/** US AQI from PM2.5 (pre-2024 breakpoints, the table the engine uses). */
export function pm25ToAqi(pm25: number): number {
  const bp: Array<[number, number, number, number]> = [
    [0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
  ];
  const c = Math.max(0, Math.min(pm25, 500.4));
  for (const [lo, hi, aLo, aHi] of bp) if (c <= hi) return Math.round(((aHi - aLo) / (hi - lo)) * (c - lo) + aLo);
  return 500;
}

/**
 * Note under the legend of the "Udara total" view. For NO2 the value is the CAMS NO2 background plus the vehicle exhaust,
 * which the kernel carries as NOx (no NO -> NO2 chemistry), so it is an upper bound on NO2, not NO2 as measured.
 */
export function totalModeNote(pollutant: string): string | null {
  if (pollutant !== 'no2') return null;
  return 'NO₂ di mode ini = NO₂ latar (CAMS) + asap kendaraan yang dihitung sebagai NOx. Tidak semua NOx menjadi NO₂, jadi angka ini batas atas, bukan NO₂ terukur.';
}
