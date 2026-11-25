/**
 * N-22: background PM2.5 for every Indonesian kab/kota (its centre point in kabkota.geojson), CAMS through Open-Meteo for
 * the next 48 hours, corrected with OpenAQ citizen sensors. Levels:
 *   terukur       a sensor within 25 km reported in the last 3 hours: CAMS scaled so the current hour equals the
 *                 distance-weighted mean of those sensors
 *   terkalibrasi  no sensor within 25 km but at least 2 within 150 km: CAMS times the median sensor/CAMS ratio there
 *   indikatif     CAMS as it is
 * The ratio is held for the 48 hours and kept within 0.25-4. Pure; the builder does the requests.
 * APIs read 25 Nov 2026 (.claude/loop/LEARN.md): Open-Meteo air-quality with comma lists answers one object per point;
 * OpenAQ v3 /parameters/2/latest is global (countries_id ignored), so the Indonesia box is applied here.
 */
import { kmBetween } from './pantau';

export const LATAR_CHUNK = 100;
export const LATAR_HOURS = 48;
export const INDONESIA_BOX = [94.5, -11.5, 141.5, 6.5] as const;
const NEAR_KM = 25, REGION_KM = 150, MAX_AGE_H = 3;

export type Tingkat = 'terukur' | 'terkalibrasi' | 'indikatif';
export interface Centre { slug: string; lon: number; lat: number }
export interface SensorNow { lon: number; lat: number; pm25: number }
export interface LatarFile {
  format: 'latar_nasional';
  updated_at: string;
  sumber: string;
  /** UTC hour starts of the 48 values */
  hours: string[];
  /** per kab/kota slug: level, sensors within 25 km, scale applied, 48 hourly values (1 decimal; null where CAMS has none) */
  wilayah: Record<string, { t: Tingkat; s: number; f: number; v: (number | null)[] }>;
  jumlah: Record<Tingkat, number>;
}

export function camsUrl(points: Array<{ lon: number; lat: number }>): string {
  const f = (x: number) => x.toFixed(3);
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${points.map((p) => f(p.lat)).join(',')}`
    + `&longitude=${points.map((p) => f(p.lon)).join(',')}&hourly=pm2_5&forecast_hours=${LATAR_HOURS}&timezone=GMT`;
}

interface CamsAnswer { hourly?: { time?: string[]; pm2_5?: (number | null)[] } }

/** One CAMS series per point from the chunked answers (an answer to a single point is an object, not a list). */
export function camsSeries(answers: Array<CamsAnswer | CamsAnswer[]>): { hours: string[]; series: (number | null)[][] } {
  const flat = answers.flatMap((a) => (Array.isArray(a) ? a : [a]));
  const hours = (flat[0]?.hourly?.time ?? []).slice(0, LATAR_HOURS).map((t) => `${t}:00Z`.replace(/:00:00Z$/, ':00Z'));
  return { hours, series: flat.map((a) => (a.hourly?.pm2_5 ?? []).slice(0, LATAR_HOURS).map((v) => (v == null || !Number.isFinite(v) ? null : v))) };
}

interface OpenAqLatest { results?: Array<{ datetime?: { utc?: string }; value?: number; coordinates?: { latitude?: number; longitude?: number } }> }

/** Sensors inside Indonesia's box that reported a plausible value (0-1000 µg/m³) in the last 3 hours. */
export function sensorsNow(pages: OpenAqLatest[], now: Date): SensorNow[] {
  const [w, s, e, n] = INDONESIA_BOX;
  const from = now.getTime() - MAX_AGE_H * 3_600_000;
  const out: SensorNow[] = [];
  for (const pg of pages) for (const r of pg.results ?? []) {
    const lat = r.coordinates?.latitude, lon = r.coordinates?.longitude, v = r.value, t = Date.parse(r.datetime?.utc ?? '');
    if (lat == null || lon == null || v == null || !Number.isFinite(v) || v <= 0 || v > 1000) continue;
    if (lon < w || lon > e || lat < s || lat > n || !(t >= from && t <= now.getTime() + 3_600_000)) continue;
    out.push({ lon, lat, pm25: v });
  }
  return out;
}

const clamp = (x: number) => Math.min(4, Math.max(0.25, x));
const median = (a: number[]) => { const q = [...a].sort((x, y) => x - y); const m = q.length >> 1; return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2; };

export function latarFile(centres: Centre[], cams: { hours: string[]; series: (number | null)[][] }, sensors: SensorNow[], now: Date): LatarFile {
  // CAMS now at each sensor: the current hour of the nearest kab/kota centre (CAMS cells are ~40 km)
  const camsAt = (lat: number, lon: number) => {
    let best = -1, d = Infinity;
    centres.forEach((c, k) => { const x = kmBetween(lat, lon, c.lat, c.lon); if (x < d) { d = x; best = k; } });
    return best >= 0 ? cams.series[best]?.[0] ?? null : null;
  };
  const ratio = sensors.map((s) => { const c = camsAt(s.lat, s.lon); return c && c > 0 ? s.pm25 / c : null; });
  const wilayah: LatarFile['wilayah'] = {};
  const jumlah: Record<Tingkat, number> = { terukur: 0, terkalibrasi: 0, indikatif: 0 };
  centres.forEach((c, k) => {
    const series = cams.series[k] ?? [];
    const now0 = series[0];
    const near = sensors.map((s, i) => ({ s, i, d: kmBetween(c.lat, c.lon, s.lat, s.lon) })).filter((x) => x.d <= REGION_KM);
    const close = near.filter((x) => x.d <= NEAR_KM);
    let t: Tingkat = 'indikatif', f = 1;
    if (close.length && now0 && now0 > 0) {
      const wsum = close.reduce((a, x) => a + 1 / Math.max(1, x.d) ** 2, 0);
      const obs = close.reduce((a, x) => a + x.s.pm25 / Math.max(1, x.d) ** 2, 0) / wsum;
      t = 'terukur'; f = clamp(obs / now0);
    } else {
      const rs = near.map((x) => ratio[x.i]).filter((r): r is number => r != null);
      if (rs.length >= 2) { t = 'terkalibrasi'; f = clamp(median(rs)); }
    }
    jumlah[t]++;
    wilayah[c.slug] = { t, s: close.length, f: Math.round(f * 100) / 100, v: series.map((x) => (x == null ? null : Math.round(x * f * 10) / 10)) };
  });
  return {
    format: 'latar_nasional', updated_at: now.toISOString(), hours: cams.hours, wilayah, jumlah,
    sumber: 'CAMS lewat Open-Meteo (48 jam), dikoreksi sensor warga OpenAQ (CC BY 4.0); tingkat terukur <= 25 km, terkalibrasi 2+ sensor <= 150 km, selain itu indikatif',
  };
}
