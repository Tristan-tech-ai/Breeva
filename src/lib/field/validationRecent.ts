/**
 * Running hourly validation (task F5-09): each kriged run's hidden-sensor test (scripts/field/hourly-validation.ts)
 * becomes one entry of v/<name>/validation_recent.json, written by the hourly builder and read by /validasi. Only the
 * statistics are kept, never the sensor readings. Hourly numbers: the EPA target (NRMSE <= 30 %) is for 24-hour means.
 */
export const MAX_ENTRIES = 72;

export interface RecentEntry {
  run: string;
  sensor_hour_utc: string | null;
  n: number;
  rmse: number;
  nrmse: number;
  bias: number;
  r2: number;
  pi95_coverage: number;
}

/** One local day of the running test, from the hourly hidden-sensor guesses (24-hour means, the EPA target). */
export interface DailyEntry {
  date: string;
  n: number;
  hours_min: number;
  nrmse: number;
  r2: number;
  slope: number;
  intercept: number;
  passes: number;
}

/** Hidden-sensor guesses of one sensor hour (kept in the private audit report of a run). */
export interface HourRows { sensor_hour_utc: string; rows: Array<{ loc_id: number; obs: number; pred: number }> }

export const MAX_DAYS = 30;
export const MIN_HOURS = 18;

export interface RecentFile {
  format: 'validation_recent';
  daily?: DailyEntry[];
  name: string;
  scope: string;
  updated_at: string;
  entries: RecentEntry[];
}

export const RECENT_SCOPE = 'per jam: tiap sensor warga disembunyikan bergiliran dan ditebak dari sensor lain pada jam yang sama';

/** Add (or replace) one run's entry, oldest first, at most max entries. */
export function mergeRecent(prev: RecentFile | null, name: string, e: RecentEntry, now: Date, max = MAX_ENTRIES): RecentFile {
  const rest = (prev?.entries ?? []).filter((x) => x.run !== e.run);
  const entries = [...rest, e].sort((a, b) => a.run.localeCompare(b.run)).slice(-max);
  return { format: 'validation_recent', name, scope: RECENT_SCOPE, updated_at: now.toISOString(), entries, ...(prev?.daily ? { daily: prev.daily } : {}) };
}

/** Local date (YYYY-MM-DD) of an instant in a zone tz hours east of UTC. */
export const localDate = (ms: number, tz: number) => new Date(ms + tz * 3_600_000).toISOString().slice(0, 10);

/**
 * Daily EPA test of one local day: each sensor's mean of its hidden-sensor guesses against the mean of its readings,
 * over the hours of that day where it was hidden (at least minHours); sensor hours counted once even when two runs
 * used the same OpenAQ hour. Null when fewer than 3 sensors have a full day.
 */
export function dailyEpa(hours: HourRows[], date: string, tz: number, minHours = MIN_HOURS): DailyEntry | null {
  const seen = new Set<string>();
  const per = new Map<number, { o: number; p: number; n: number }>();
  for (const h of hours) {
    if (seen.has(h.sensor_hour_utc) || localDate(Date.parse(h.sensor_hour_utc), tz) !== date) continue;
    seen.add(h.sensor_hour_utc);
    for (const r of h.rows) {
      const a = per.get(r.loc_id) ?? { o: 0, p: 0, n: 0 };
      a.o += r.obs; a.p += r.pred; a.n++;
      per.set(r.loc_id, a);
    }
  }
  const full = [...per.values()].filter((a) => a.n >= minHours);
  if (full.length < 3) return null;
  const obs = full.map((a) => a.o / a.n), pred = full.map((a) => a.p / a.n);
  const n = obs.length, mo = obs.reduce((s, x) => s + x, 0) / n, mp = pred.reduce((s, x) => s + x, 0) / n;
  let se = 0, sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { se += (pred[k] - obs[k]) ** 2; sxy += (obs[k] - mo) * (pred[k] - mp); sxx += (obs[k] - mo) ** 2; syy += (pred[k] - mp) ** 2; }
  const nrmse = Math.sqrt(se / n) / mo, r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0, slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = mp - slope * mo;
  const f = (x: number, d = 3) => Number(x.toFixed(d));
  const passes = [nrmse <= 0.3, r2 >= 0.7, Math.abs(slope - 1) <= 0.35, Math.abs(intercept) <= 5].filter(Boolean).length;
  return { date, n, hours_min: Math.min(...full.map((a) => a.n)), nrmse: f(nrmse), r2: f(r2), slope: f(slope), intercept: f(intercept, 2), passes };
}

/** Add (or replace) a day, oldest first, at most max days; the hourly entries stay as they are. */
export function mergeDaily(f: RecentFile, d: DailyEntry, max = MAX_DAYS): RecentFile {
  const daily = [...(f.daily ?? []).filter((x) => x.date !== d.date), d].sort((a, b) => a.date.localeCompare(b.date)).slice(-max);
  return { ...f, daily };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : Number.NaN;
};

export interface RecentSummary { hours: number; median_nrmse: number; median_rmse: number; median_coverage: number; sensors_median: number; last_run: string | null }

export function summarizeRecent(f: RecentFile | null): RecentSummary | null {
  const es = f?.entries ?? [];
  if (!es.length) return null;
  return {
    hours: es.length,
    median_nrmse: median(es.map((e) => e.nrmse)),
    median_rmse: median(es.map((e) => e.rmse)),
    median_coverage: median(es.map((e) => e.pi95_coverage)),
    sensors_median: median(es.map((e) => e.n)),
    last_run: es[es.length - 1].run,
  };
}
