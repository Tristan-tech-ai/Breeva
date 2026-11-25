/**
 * N-09: national fire points from NASA FIRMS (VIIRS S-NPP, NOAA-20, NOAA-21, near real time), last 24 hours over
 * Indonesia. API: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{W,S,E,N}/{DAYS} (read 25 Nov 2026).
 */
export const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'] as const;
export const INDONESIA_BBOX = [94.5, -11.5, 141.5, 6.5] as const; // W, S, E, N

/** One fire point: lon, lat, fire radiative power (MW), confidence (l|n|h), UTC time ISO, satellite code, and (since N-23)
 * the kab/kota slug and province code it lies in. */
export type FirePoint = [number, number, number, string, string, string, string?, string?];

export interface FireFile {
  format: 'titik_api';
  updated_at: string;
  sumber: string;
  window_hours: number;
  n: number;
  per_satelit: Record<string, number>;
  /** points in the FIRMS box but outside Indonesia's kab/kota boundaries (Malaysia, Timor-Leste, PNG, sea), dropped */
  luar_indonesia?: number;
  per_provinsi?: Record<string, number>;
  points: FirePoint[];
}

export function firmsUrl(key: string, source: string, days = 2): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${INDONESIA_BBOX.join(',')}/${days}`;
}

/** Parse one FIRMS VIIRS CSV and keep the points detected in the `hours` before `now`. */
export function parseFirmsCsv(csv: string, now: Date, hours = 24): FirePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0].includes('latitude')) return [];
  const head = lines[0].split(',');
  const col = (n: string) => head.indexOf(n);
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp] = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'confidence', 'frp'].map(col);
  if ([iLat, iLon, iDate, iTime].some((i) => i < 0)) return [];
  const from = now.getTime() - hours * 3_600_000;
  const out: FirePoint[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = Number(c[iLat]), lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hhmm = String(c[iTime]).padStart(4, '0');
    const t = Date.parse(`${c[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (!Number.isFinite(t) || t < from || t > now.getTime() + 3_600_000) continue;
    out.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, iFrp >= 0 ? Math.round(Number(c[iFrp]) * 10) / 10 : 0,
      iConf >= 0 ? String(c[iConf]).trim().toLowerCase().slice(0, 1) : 'n', new Date(t).toISOString().slice(0, 16) + 'Z', iSat >= 0 ? String(c[iSat]).trim() : '']);
  }
  return out;
}

export function fireFile(bySource: Record<string, FirePoint[]>, now: Date): FireFile {
  const points = Object.values(bySource).flat().sort((a, b) => (a[4] < b[4] ? -1 : 1));
  return {
    format: 'titik_api', updated_at: now.toISOString(), sumber: 'NASA FIRMS VIIRS NRT (S-NPP, NOAA-20, NOAA-21)', window_hours: 24,
    n: points.length, per_satelit: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.length])), points,
  };
}
