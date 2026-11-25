/**
 * N-27: the open Sensor.Community sensors in Indonesia, pulled every hour by the builder into
 * v/nasional/sensor_community.json (API read 25 Nov 2026: https://data.sensor.community/airrohr/v1/filter/country=ID,
 * last 5 minutes; P2 = PM2.5, P1 = PM10; data under DbCL 1.0). Shown on /sensor and /pantau as "tidak dipakai model":
 * citizen and user sensors do not enter the map numbers (decision 25 Nov).
 */
export const SC_URL = 'https://data.sensor.community/airrohr/v1/filter/country=ID';

export interface ScSensor { id: number; lat: number; lon: number; pm25: number | null; pm10: number | null; t: string; tipe: string; dalam: boolean }
export interface ScFile { format: 'sensor_community'; updated_at: string; sumber: string; lisensi: string; sensors: ScSensor[] }

interface ScEntry {
  timestamp?: string;
  location?: { latitude?: string; longitude?: string; indoor?: number };
  sensor?: { id?: number; sensor_type?: { name?: string } };
  sensordatavalues?: Array<{ value_type?: string; value?: string }>;
}

const num = (v: string | undefined, lo: number, hi: number) => {
  const x = Number(v);
  return v != null && Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : null;
};

/** The newest reading per sensor with PM values (temperature-only sensors left out), location to 3 decimals. */
export function scFile(entries: ScEntry[], now: Date): ScFile {
  const by = new Map<number, ScSensor>();
  for (const e of entries) {
    const id = e.sensor?.id, lat = Number(e.location?.latitude), lon = Number(e.location?.longitude);
    if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const v = (k: string) => e.sensordatavalues?.find((d) => d.value_type === k)?.value;
    const pm25 = num(v('P2'), 0, 1000), pm10 = num(v('P1'), 0, 2000);
    if (pm25 == null && pm10 == null) continue;
    const t = (e.timestamp ?? '').replace(' ', 'T') + 'Z';
    const prev = by.get(id);
    if (prev && prev.t >= t) continue;
    by.set(id, { id, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, pm25, pm10, t, tipe: e.sensor?.sensor_type?.name ?? '', dalam: e.location?.indoor === 1 });
  }
  return {
    format: 'sensor_community', updated_at: now.toISOString(), sumber: 'Sensor.Community (data.sensor.community), 5 menit terakhir saat diambil',
    lisensi: 'DbCL 1.0', sensors: [...by.values()].sort((a, b) => a.id - b.id),
  };
}
