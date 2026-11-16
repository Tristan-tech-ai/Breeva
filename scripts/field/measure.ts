/**
 * Measurements for one field hour: citizen-sensor PM2.5 from OpenAQ (vetted sensors of the region) and airport
 * visibility from the Iowa Environmental Mesonet METAR archive. Choosing what the field uses:
 *   1. kriging      at least min_sensors vetted sensors reported the hour: log-space ordinary kriging of them;
 *   2. koschmieder  otherwise, when the region's airport hour is smoky (scripts/field/smoke.ts);
 *   3. none         otherwise: the engine's own background (Open-Meteo / CAMS calibration).
 * Network calls take a fetch function so tests can run offline.
 */
import type { Variogram } from './kriging.js';
import { koschmiederPm25, parseIemCsv, summariseHour, type MetarHour } from './smoke.js';

export interface VettedSensor { loc_id: number; sensor_id: number; name: string; lat: number; lon: number }
export interface SensorReading { loc_id: number; lat: number; lon: number; pm25: number }

export interface RegionMeasureParams {
  network?: 'openaq';
  min_sensors?: number;
  variogram_log?: Variogram;
  /** Widening of the kriging sd so the 95 % interval holds 95 % of hidden readings (validate-sensors.mts, F5-05). */
  pi_scale?: number;
  sensors?: VettedSensor[];
  metar?: string;
  alpha_m2g?: number;
}

export interface MeasuredInputs {
  method: 'kriging' | 'koschmieder' | 'none';
  hour_utc: string;
  sensors: SensorReading[];
  /** Hour (UTC start) the kriged sensor readings belong to; up to the lookback before hour_utc. */
  sensor_hour_utc?: string;
  sensors_vetted: number;
  variogram_log?: Variogram;
  pi_scale?: number;
  metar?: MetarHour;
  koschmieder?: { pm25: number; reason: 'smoke' | 'low_visibility'; alpha_m2g: number };
  note: string;
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string>; headers: { get(k: string): string | null } }>;

const OPENAQ = 'https://api.openaq.org/v3';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

/**
 * Hourly values of each vetted sensor for the hours [hourUtc - lookback h, hourUtc], keyed by hour start (UTC).
 * OpenAQ publishes an hour's aggregate one to two hours after it ends (checked 16 Nov 2026: at 09:10 UTC the newest
 * hour was 07:00-08:00), so the caller picks the newest hour enough sensors have. The /hours filter applies to the end
 * of each period. Readings outside 0..1000 ug/m3 are dropped (as in analysis H).
 */
export async function fetchOpenAqRecent(
  sensors: VettedSensor[], hourUtc: Date, key: string, opts: { fetchImpl?: Fetch; spacingMs?: number; lookbackHours?: number } = {},
): Promise<{ byHour: Map<string, SensorReading[]>; failed: string[] }> {
  const f = opts.fetchImpl ?? (fetch as unknown as Fetch);
  const back = opts.lookbackHours ?? 3;
  const from = iso(new Date(hourUtc.getTime() - back * 3600_000));
  const to = iso(new Date(hourUtc.getTime() + 3600_000));
  const byHour = new Map<string, SensorReading[]>();
  const failed: string[] = [];
  for (const s of sensors) {
    let res: Awaited<ReturnType<Fetch>> | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await f(`${OPENAQ}/sensors/${s.sensor_id}/hours?datetime_from=${from}&datetime_to=${to}&limit=${back + 2}`, { headers: { 'X-API-Key': key } });
      if (res.status !== 429) break;
      await sleep(1000 * Math.max(1, Number(res.headers.get('x-ratelimit-reset') ?? 5)));
    }
    if (!res || !res.ok) { failed.push(`${s.sensor_id}:${res?.status ?? 'none'}`); continue; }
    const js = (await res.json()) as { results?: Array<{ value?: number; period?: { datetimeFrom?: { utc?: string } } }> };
    const seen = new Set<string>();
    for (const q of js.results ?? []) {
      const h = q?.period?.datetimeFrom?.utc;
      const v = Number(q?.value);
      if (!h || seen.has(h) || !(v >= 0 && v < 1000)) continue;
      seen.add(h);
      const list = byHour.get(h) ?? [];
      list.push({ loc_id: s.loc_id, lat: s.lat, lon: s.lon, pm25: v });
      byHour.set(h, list);
    }
    if (opts.spacingMs) await sleep(opts.spacingMs);
  }
  return { byHour, failed };
}

/** METAR reports of one station for the hour, summarised as analysis F does. */
export async function fetchMetarHour(station: string, hourUtc: Date, opts: { fetchImpl?: Fetch } = {}): Promise<MetarHour> {
  const f = opts.fetchImpl ?? (fetch as unknown as Fetch);
  const a = hourUtc, b = new Date(hourUtc.getTime() + 3600_000);
  const p = (d: Date, n: string) =>
    `&year${n}=${d.getUTCFullYear()}&month${n}=${d.getUTCMonth() + 1}&day${n}=${d.getUTCDate()}&hour${n}=${d.getUTCHours()}&minute${n}=0`;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${station}&data=vsby&data=relh&data=wxcodes`
    + `${p(a, '1')}${p(b, '2')}&tz=Etc/UTC&format=onlycomma&latlon=yes&missing=M&trace=T&direct=no&report_type=3&report_type=4`;
  const res = await f(url);
  if (!res.ok) throw new Error(`IEM ASOS ${res.status}`);
  return summariseHour(parseIemCsv(await res.text()), station, a.toISOString());
}

/** Decide the measurement layer for one region and hour. Never throws for a network failure: it falls back and says so. */
export async function measureHour(
  params: RegionMeasureParams | undefined, hourUtc: Date, env: { openaqKey?: string },
  opts: { fetchImpl?: Fetch; spacingMs?: number; lookbackHours?: number } = {},
): Promise<MeasuredInputs> {
  const base: MeasuredInputs = { method: 'none', hour_utc: hourUtc.toISOString(), sensors: [], sensors_vetted: params?.sensors?.length ?? 0, note: '' };
  if (!params) return { ...base, note: 'no measurement parameters for this region' };
  const notes: string[] = [];
  if (params.network === 'openaq' && params.sensors?.length && params.variogram_log) {
    if (!env.openaqKey) notes.push('OPENAQ_API_KEY not set');
    else {
      try {
        const { byHour, failed } = await fetchOpenAqRecent(params.sensors, hourUtc, env.openaqKey, opts);
        const need = params.min_sensors ?? 3;
        // Newest hour that enough sensors reported; one snapshot hour, never a mix of hours.
        const hour = [...byHour.keys()].sort().reverse().find((h) => byHour.get(h)!.length >= need);
        const fail = failed.length ? `, requests failed (sensor:status) ${failed.join(' ')}` : '';
        if (hour) {
          const readings = byHour.get(hour)!;
          const lag = Math.round((hourUtc.getTime() - Date.parse(hour)) / 3600_000);
          notes.push(`${readings.length} of ${params.sensors.length} vetted sensors reported hour ${hour} (${lag} h before the field hour)${fail}`);
          return { ...base, method: 'kriging', sensors: readings, sensor_hour_utc: hour, variogram_log: params.variogram_log, pi_scale: params.pi_scale ?? 1, note: notes.join('; ') };
        }
        notes.push(`fewer than ${need} vetted sensors reported in the last ${(opts.lookbackHours ?? 3) + 1} hours${fail}`);
      } catch (e) {
        notes.push(`OpenAQ failed: ${(e as Error).message}`);
      }
    }
  }
  if (params.metar && params.alpha_m2g) {
    try {
      const h = await fetchMetarHour(params.metar, hourUtc, opts);
      base.metar = h;
      const k = koschmiederPm25(h, params.alpha_m2g);
      notes.push(`${params.metar}: ${h.reports} reports${k ? `, ${k.reason}` : ', no smoke'}`);
      if (k) return { ...base, method: 'koschmieder', koschmieder: { ...k, alpha_m2g: params.alpha_m2g }, note: notes.join('; ') };
    } catch (e) {
      notes.push(`METAR failed: ${(e as Error).message}`);
    }
  }
  return { ...base, note: notes.join('; ') };
}
