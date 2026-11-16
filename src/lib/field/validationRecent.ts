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

export interface RecentFile {
  format: 'validation_recent';
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
  return { format: 'validation_recent', name, scope: RECENT_SCOPE, updated_at: now.toISOString(), entries };
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
