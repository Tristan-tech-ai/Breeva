/**
 * What the route card says while the router's files download (X-W4). On a slow 3G link the first route of a region
 * waits for about 1 MB of walking graph (about 50 s, lambat3g_rute_cache_sesudah2_2026-11-18.json); a spinner alone
 * looks like a hang. Short waits keep the plain text, so a fast connection never sees the download message.
 */
export const SHOW_PROGRESS_AFTER_MS = 3000;
export const COMPUTING = 'Menghitung rute di perangkat…';

const nf = (x: number, d: number) => x.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

/** "350 KB" or "1,2 MB" (1 MB = 1.000.000 byte, as the download size is reported to people). */
export function sizeText(bytes: number): string {
  return bytes < 1_000_000 ? `${nf(Math.max(0, Math.round(bytes / 1000)), 0)} KB` : `${nf(bytes / 1_000_000, 1)} MB`;
}

export function routeLoadingText(bytes: number, elapsedMs: number): string {
  if (elapsedMs < SHOW_PROGRESS_AFTER_MS) return COMPUTING;
  return `Mengunduh peta jalan kaki wilayah ini: ${sizeText(bytes)} diterima. Pertama kali di sinyal lemah bisa hampir satu menit; sesudahnya tersimpan di ponsel.`;
}

/** Calls post with the running total at most every intervalMs (and never twice for the same total). */
export function progressCounter(post: (total: number) => void, intervalMs = 250, now: () => number = () => Date.now()) {
  let total = 0, lastAt = -Infinity, lastTotal = -1;
  return (delta: number) => {
    total += delta;
    const t = now();
    if (t - lastAt >= intervalMs && total !== lastTotal) { lastAt = t; lastTotal = total; post(total); }
  };
}
