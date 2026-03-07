/**
 * POI Pipeline Diagnostics
 * 
 * Enable in browser console:  window.__POI_DIAG = true
 * Disable:                      window.__POI_DIAG = false
 * 
 * Measures:
 *  - moveend → triggerFetch delay (debounce overhead)
 *  - Number of tiles in viewport vs cache hits
 *  - Per-tile fetch latency (network + parse)
 *  - localStorage cache hit/miss ratio
 *  - Batch apply timing (Zustand set())
 *  - Supercluster reindex timing
 *  - Label collision timing
 *  - DOM marker creation timing
 */

declare global {
  interface Window { __POI_DIAG?: boolean; }
}

const enabled = () => typeof window !== 'undefined' && window.__POI_DIAG === true;

const timers = new Map<string, number>();

export function diagStart(label: string): void {
  if (!enabled()) return;
  timers.set(label, performance.now());
}

export function diagEnd(label: string, extra?: Record<string, unknown>): void {
  if (!enabled()) return;
  const start = timers.get(label);
  if (start == null) return;
  const ms = performance.now() - start;
  timers.delete(label);
  const parts = [`[POI] ${label}: ${ms.toFixed(1)}ms`];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${JSON.stringify(v)}`);
  }
  console.log(parts.join('  '));
}

export function diagLog(msg: string, extra?: Record<string, unknown>): void {
  if (!enabled()) return;
  const parts = [`[POI] ${msg}`];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${JSON.stringify(v)}`);
  }
  console.log(parts.join('  '));
}

/** Summary table for a fetch cycle */
export function diagFetchSummary(data: {
  totalTiles: number;
  cachedTiles: number;
  networkTiles: number;
  tileTimings: number[];  // ms per tile (network only)
  totalMs: number;
}): void {
  if (!enabled()) return;
  const { totalTiles, cachedTiles, networkTiles, tileTimings, totalMs } = data;
  const avgMs = tileTimings.length > 0 ? tileTimings.reduce((a, b) => a + b, 0) / tileTimings.length : 0;
  const maxMs = tileTimings.length > 0 ? Math.max(...tileTimings) : 0;
  console.log(
    `[POI] ── Fetch Summary ──\n` +
    `  Total tiles: ${totalTiles} (${cachedTiles} cached, ${networkTiles} network)\n` +
    `  Avg tile latency: ${avgMs.toFixed(0)}ms  Max: ${maxMs.toFixed(0)}ms\n` +
    `  Total fetch→render: ${totalMs.toFixed(0)}ms`
  );
}
