/**
 * How soon after an hour ends do the vetted OpenAQ sensors of a region report it (task X-W91)? Reads the same sensor list
 * and API as the builder (scripts/field/measure.ts fetchOpenAqRecent) and prints, for the probe time, how many sensors have
 * each of the last hours. Run it at :20 (the builder's minute) and :50 to see whether a later fetch gets a newer hour.
 * OPENAQ_API_KEY comes from the environment or .env.local; it is never printed.
 *
 *   pnpm exec tsx scripts/field/openaq-lag-probe.mts --name badung_denpasar --out D:/breeva-ml-data/field/reports/lag_probe.json
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fetchOpenAqRecent, type RegionMeasureParams } from './measure.js';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'badung_denpasar');
const out = arg('out', '');
let key = process.env.OPENAQ_API_KEY ?? '';
const envFile = 'C:/Users/Tristan/Downloads/breeva/.env.local';
if (!key && existsSync(envFile)) {
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENAQ_API_KEY='));
  key = line ? line.slice('OPENAQ_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
}
if (!key) throw new Error('OPENAQ_API_KEY not available');
const params = (JSON.parse(readFileSync('scripts/field/params/measure.json', 'utf8')).regions ?? {})[name] as RegionMeasureParams;
const now = new Date();
const thisHour = new Date(Math.floor(now.getTime() / 3600_000) * 3600_000);
// the builder's window at this minute: field hour = last complete hour, lookback 3 h; here one hour wider at the top
const { byHour, failed } = await fetchOpenAqRecent(params.sensors!, thisHour, key, { spacingMs: 1100, lookbackHours: 4 });
const counts = Object.fromEntries([...byHour.entries()].sort().map(([h, v]) => [h, v.length]));
const newest = [...byHour.keys()].sort().reverse().find((h) => byHour.get(h)!.length >= (params.min_sensors ?? 3)) ?? null;
const row = {
  wilayah: name, diperiksa_utc: now.toISOString(), menit: now.getUTCMinutes(), sensor: params.sensors!.length,
  jam_terbaru_cukup: newest, umur_jam_terbaru_menit: newest ? Math.round((now.getTime() - (Date.parse(newest) + 3600_000)) / 60000) : null,
  sensor_per_jam: counts, gagal: failed.length,
};
console.log(JSON.stringify(row));
if (out) appendFileSync(out, JSON.stringify(row) + '\n');
