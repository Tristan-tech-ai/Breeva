/**
 * The builder's recent runs per region (task F2-23): v/<name>/runs_recent.json, written by the hourly builder after
 * every region it tries, read by /status. A failed region is kept with a short reason, so a missing hour is visible
 * instead of silent (run 2026111717 lost Badung-Denpasar and nothing on the site said so).
 */
export const MAX_RUNS = 48;

export interface RunRecord { run: string; ok: boolean; seconds?: number; reason?: string }
export interface RunsFile { format: 'runs_recent'; name: string; updated_at: string; runs: RunRecord[] }

/** A reason short enough for a public page, without query strings (an API key never sits in a URL, but just in case). */
export function shortReason(message: string): string {
  return message.replace(/\?[^\s)]*/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Add (or replace) one run, oldest first, at most max runs. */
export function mergeRuns(prev: RunsFile | null, name: string, rec: RunRecord, now: Date, max = MAX_RUNS): RunsFile {
  const runs = [...(prev?.runs ?? []).filter((r) => r.run !== rec.run), rec].sort((a, b) => a.run.localeCompare(b.run)).slice(-max);
  return { format: 'runs_recent', name, updated_at: now.toISOString(), runs };
}

/** Run id (YYYYMMDDHH, UTC) shifted by h hours. */
export function shiftRun(run: string, h: number): string {
  const t = Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +run.slice(8, 10)) + h * 3_600_000;
  return new Date(t).toISOString().slice(0, 13).replace(/[-T]/g, '');
}

/**
 * The last `hours` hours up to the newest run: how many were published, and the hours that failed or are missing
 * (a run that never wrote anything). Null without runs.
 */
export function runsSummary(f: RunsFile | null, hours = 24) {
  const runs = f?.runs ?? [];
  if (!runs.length) return null;
  const last = runs.reduce((m, r) => (r.run > m ? r.run : m), runs[0].run);
  const byRun = new Map(runs.map((r) => [r.run, r]));
  const window = Array.from({ length: hours }, (_, k) => shiftRun(last, k - hours + 1));
  const first = runs.reduce((m, r) => (r.run < m ? r.run : m), runs[0].run);
  const due = window.filter((r) => r >= first); // hours before the file began are not counted as missing
  const failed = due.filter((r) => byRun.get(r)?.ok === false).map((r) => ({ run: r, reason: byRun.get(r)!.reason ?? '' }));
  const missing = due.filter((r) => !byRun.has(r));
  return { hours: due.length, ok: due.filter((r) => byRun.get(r)?.ok === true).length, failed, missing, last };
}

/** Hour start of a run id as a Date. */
export const runDate = (run: string) => new Date(Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +run.slice(8, 10)));

/** The /status line: published hours of the last day, then each failed or missing hour (time written by fmt). */
export function runsText(s: NonNullable<ReturnType<typeof runsSummary>>, fmt: (d: Date) => string): string {
  const head = `Dalam ${s.hours} jam terakhir: ${s.ok} dari ${s.hours} jam terbit.`;
  const bad = [
    ...s.failed.map((f) => `${fmt(runDate(f.run))} gagal${f.reason ? ` (${f.reason})` : ''}`),
    ...s.missing.map((m) => `${fmt(runDate(m))} tidak tercatat`),
  ];
  return bad.length ? `${head} ${bad.join('; ')}.` : head;
}

export type HourState = 'ok' | 'gagal' | 'hilang' | 'sebelum';

/** N-07: the last `hours` run hours as states, oldest first: published, failed, missing, or before the file began. */
export function runsStrip(f: RunsFile | null, hours = 24): Array<{ run: string; state: HourState }> | null {
  const runs = f?.runs ?? [];
  if (!runs.length) return null;
  const last = runs.reduce((m, r) => (r.run > m ? r.run : m), runs[0].run);
  const first = runs.reduce((m, r) => (r.run < m ? r.run : m), runs[0].run);
  const byRun = new Map(runs.map((r) => [r.run, r]));
  return Array.from({ length: hours }, (_, k) => {
    const run = shiftRun(last, k - hours + 1);
    const r = byRun.get(run);
    return { run, state: run < first ? 'sebelum' : !r ? 'hilang' : r.ok ? 'ok' : 'gagal' };
  });
}
