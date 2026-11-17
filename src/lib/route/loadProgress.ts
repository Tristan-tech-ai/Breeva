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

/**
 * sentBytes: the size the files travel at (sum of their Content-Length, brotli or gzip encoded), which is what a data
 * plan pays; the decoded size is about three times larger and would overstate it. Unknown (0) leaves the size out.
 */
export function routeLoadingText(sentBytes: number, elapsedMs: number): string {
  if (elapsedMs < SHOW_PROGRESS_AFTER_MS) return COMPUTING;
  const size = sentBytes > 0 ? ` (sekitar ${sizeText(sentBytes)})` : '';
  return `Mengunduh peta jalan kaki wilayah ini, sekali saja${size}. Sudah ${Math.floor(elapsedMs / 1000)} detik; di sinyal lemah bisa hampir satu menit, sesudahnya tersimpan di ponsel.`;
}

/**
 * Download meter for the worker: start(contentLength) for each response, bytes(n) for each decoded chunk. post receives
 * the encoded size of the responses started so far, at most every intervalMs, and only while bytes keep arriving.
 */
export function progressCounter(post: (sentBytes: number) => void, intervalMs = 250, now: () => number = () => Date.now()) {
  let sent = 0, lastAt = -Infinity;
  return {
    start(contentLength: number | null) { if (contentLength && contentLength > 0) sent += contentLength; },
    bytes(n: number) {
      if (n <= 0) return;
      const t = now();
      if (t - lastAt >= intervalMs) { lastAt = t; post(sent); }
    },
  };
}
