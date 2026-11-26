/**
 * WIB (Asia/Jakarta, UTC+7) calendar helpers shared by the quest day and the weekly leaderboard, which the server keys
 * by the WIB date and by the Monday that starts the WIB week (leaderboard_weekly.week_start).
 */
const WIB_MS = 7 * 3600 * 1000;

/** The WIB calendar date, YYYY-MM-DD. */
export function wibToday(now: number = Date.now()): string {
  return new Date(now + WIB_MS).toISOString().slice(0, 10);
}

/** The Monday that starts the WIB week containing `now`, YYYY-MM-DD. */
export function wibWeekStart(now: number = Date.now()): string {
  const d = new Date(now + WIB_MS);
  const back = (d.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

/** A weekly rank counts as "this week" only when its row belongs to the current WIB week. */
export function rankThisWeek(row: { rank?: number | null; week_start?: string | null } | null, now: number = Date.now()): number | null {
  if (!row || !row.rank || row.rank <= 0) return null;
  return row.week_start === wibWeekStart(now) ? row.rank : null;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** 'pekan ini' for the current WIB week, otherwise the week as dates, e.g. 'pekan 15–21 Jun 2026'. */
export function labelPekan(weekStart: string | null | undefined, now: number = Date.now()): string {
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return 'pekan ini';
  if (weekStart === wibWeekStart(now)) return 'pekan ini';
  const a = new Date(`${weekStart}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const da = a.getUTCDate(), db = b.getUTCDate();
  const ma = BULAN[a.getUTCMonth()], mb = BULAN[b.getUTCMonth()];
  const ya = a.getUTCFullYear(), yb = b.getUTCFullYear();
  if (ya !== yb) return `pekan ${da} ${ma} ${ya}–${db} ${mb} ${yb}`;
  if (ma !== mb) return `pekan ${da} ${ma}–${db} ${mb} ${yb}`;
  return `pekan ${da}–${db} ${mb} ${yb}`;
}
