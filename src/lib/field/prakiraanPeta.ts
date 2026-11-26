/**
 * M-U08: the forecast hours the in-app map can honestly show: only those the field builder computed for the current run
 * (manifest forecast_runs: the next 3 hours and the next 07.00 and 13.00 local). The forecast covers the exhaust part only.
 */
import type { ForecastEntry } from './forecast';

export interface PilihanPrakiraan { ahead: number; label: string }

export function pilihanPrakiraan(entries: readonly ForecastEntry[] | null | undefined, runLocalHour: number | null | undefined): PilihanPrakiraan[] {
  if (!entries?.length || runLocalHour == null) return [];
  const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}.00`;
  return [...entries].filter((e) => e.ahead >= 1 && e.ahead <= 24).sort((a, b) => a.ahead - b.ahead)
    .map((e) => ({ ahead: e.ahead, label: e.ahead <= 3 ? `+${e.ahead} jam (${hh(e.local_hour)})` : `${hh(e.local_hour)}${runLocalHour + e.ahead >= 24 ? ' besok' : ''}` }));
}
