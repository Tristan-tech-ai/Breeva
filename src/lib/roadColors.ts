// Road colors and widths shared by the road layers (PostGIS MVT and the static field), so both draw the same.

export const TOTAL_STOPS: Record<string, [number, string][]> = {
  aqi:  [[0, '#00E400'], [50, '#FFFF00'], [100, '#FF7E00'], [150, '#FF0000'], [200, '#8F3F97'], [300, '#7E0023']],
  pm25: [[0, '#00E400'], [12, '#FFFF00'], [35.4, '#FF7E00'], [55.4, '#FF0000'], [150.4, '#8F3F97'], [250.4, '#7E0023']],
  no2:  [[0, '#00E400'], [40, '#FFFF00'], [100, '#FF7E00'], [200, '#FF0000'], [400, '#8F3F97'], [1000, '#7E0023']],
  o3:   [[0, '#00E400'], [60, '#FFFF00'], [100, '#FF7E00'], [140, '#FF0000'], [240, '#8F3F97'], [380, '#7E0023']],
  pm10: [[0, '#00E400'], [54, '#FFFF00'], [154, '#FF7E00'], [254, '#FF0000'], [354, '#8F3F97'], [424, '#7E0023']],
};
export const DELTA_STOPS: Record<string, [number, string][]> = {
  pm25: [[0, '#00E400'], [0.5, '#FFFF00'], [2, '#FF7E00'], [5, '#FF0000'], [10, '#8F3F97'], [25, '#7E0023']],
  no2:  [[0, '#00E400'], [2, '#FFFF00'], [10, '#FF7E00'], [25, '#FF0000'], [60, '#8F3F97'], [150, '#7E0023']],
  pm10: [[0, '#00E400'], [1, '#FFFF00'], [4, '#FF7E00'], [10, '#FF0000'], [20, '#8F3F97'], [50, '#7E0023']],
};
// Seed divisor for contrast's first paint (before the real viewport p90 is measured).
export const CONTRAST_FALLBACK: Record<string, number> = { pm25: 6, no2: 25, pm10: 10 };

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
export function weightFor(highway: string, zoom: number): number {
  const t = Math.max(0, (zoom - 12) / 4);
  const lo = MAJOR.has(highway) ? 1.6 : PRIMARY.has(highway) ? 1.1 : 0.6;
  const hi = MAJOR.has(highway) ? 6 : PRIMARY.has(highway) ? 4 : 2.2;
  return lo + (hi - lo) * Math.min(t, 1.75);
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
