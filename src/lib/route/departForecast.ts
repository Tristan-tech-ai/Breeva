/**
 * Field values of a departure hour for the router (task F3-10), pure and tested. The forecast replaces only the
 * traffic part: background NO2 of the run is kept (persistence), so NO2 of an edge = run NO2 - run exhaust + forecast
 * exhaust.
 */
import type { WalkGraph } from './walkGraph';

/** Exhaust per edge from a forecast file decoded per cell (decodeExhaust); edges without a road stay NaN. */
export function edgeExhaust(g: Pick<WalkGraph, 'm' | 'road'>, byCell: Map<number, Float32Array>): Float64Array {
  const x = new Float64Array(g.m).fill(Number.NaN);
  for (let e = 0; e < g.m; e++) {
    const r = g.road(e);
    if (!r) continue;
    const v = byCell.get(r.c)?.[r.i];
    if (v != null) x[e] = v;
  }
  return x;
}

/** NO2 per edge at the departure hour: run NO2 with the run's exhaust swapped for the forecast exhaust. */
export function no2AtHour(no2Now: Float64Array, exhaustNow: Float64Array, exhaustAt: Float64Array): Float64Array {
  const out = new Float64Array(no2Now.length);
  for (let e = 0; e < out.length; e++) {
    const n = no2Now[e], x0 = exhaustNow[e], x1 = exhaustAt[e];
    out[e] = Number.isFinite(n) && Number.isFinite(x0) && Number.isFinite(x1) ? Math.max(0, n - x0 + x1) : n;
  }
  return out;
}

/** Mean exhaust along a route's edges (time-weighted with the route's own speed), ug/m3. */
export function meanAlong(g: Pick<WalkGraph, 'lenDm'>, edges: readonly number[], timeS: number, lengthM: number, x: Float64Array): number {
  let dose = 0, t = 0;
  for (const e of edges) {
    const tS = (g.lenDm[e] / 10) * (timeS / Math.max(1, lengthM));
    t += tS;
    dose += (Number.isFinite(x[e]) ? x[e] : 0) * tS;
  }
  return t > 0 ? dose / t : 0;
}

export interface SoonHour { local_hour: number; ahead: number; exhMean: number }

/** Hours a trip is suggested for: 05.00 to 21.00 local (a quieter road at 02.00 is no advice for a walk to school). */
export const SUGGEST_HOURS: readonly [number, number] = [5, 21];

/**
 * The best of the next hours (within SUGGEST_HOURS) for the same route, when it breathes at least 10 % less exhaust
 * than leaving now; null otherwise (and when the route has practically no exhaust).
 */

export function bestSoon(nowMean: number, soon: readonly SoonHour[], minGain = 0.1, floor = 0.5): { hour: SoonHour; pct: number } | null {
  const ok = soon.filter((h) => h.local_hour >= SUGGEST_HOURS[0] && h.local_hour <= SUGGEST_HOURS[1]);
  if (!(nowMean >= floor) || !ok.length) return null;
  const best = ok.reduce((a, b) => (b.exhMean < a.exhMean ? b : a));
  const pct = Math.round((1 - best.exhMean / nowMean) * 100);
  return best.exhMean <= nowMean * (1 - minGain) ? { hour: best, pct } : null;
}

/**
 * Starts a download, then waits for something else, then gives the download's result (null when there is none or it
 * failed). F1-64: a motor route waits for the edge shapes, and the departure hour's forecast file used to be asked for
 * only after them (36,2 -> 39,1 s on a slow 3G link, jalur_kritis_3g_2026-11-18.json); started first, both come down
 * together.
 */
export async function startThenWait<T>(start: (() => Promise<T>) | null, wait: Promise<unknown>): Promise<T | null> {
  const p = start ? start() : null;
  p?.catch(() => undefined); // awaited below; this keeps an early failure from going unhandled meanwhile
  await wait;
  if (!p) return null;
  try { return await p; } catch { return null; }
}
