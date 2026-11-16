/**
 * "Tutup jalan depan sekolah" (task F4-02): what closing the road at a school gate to vehicles does to the exhaust
 * breathed at the gate, and where the exhaust goes instead. Pure and tested; the batch script
 * scripts/field/simulate-closure.mts feeds it the road pack, the motor graph and the harga hirup of a region.
 *
 * Concentration from a road is linear in its vehicles per hour (src/lib/field/exhaust.ts), so with per-road unit
 * contributions u_j (ug/m3 per vehicle/hour) at the gate:
 *   before = sum_j u_j v_j,   after = before - sum_{g in gate} u_g v_g + sum_{d in detour} u_d m,
 * where m is the vehicles per hour moved off the gate road onto the detour (all of them: a closure, not a toll).
 */
import { EMISSION_G_PER_KM, lineKernel, type ExhaustSource, type Met } from '../field/exhaust';

const M_LAT = 110574;
const M_LON_EQ = 111320;
const UG_PER_VEH = (EMISSION_G_PER_KM.nox * 1e6) / 3600 / 1000; // ug/m/s of NOx per vehicle/hour

/** NOx (ug/m3) per vehicle/hour on each road within the cut-off of the receptor (its modifier included). */
export function unitContributions(sources: readonly ExhaustSource[], at: { lat: number; lon: number }, met: Met, only?: Iterable<number>, cutoffM = 500): Map<number, number> {
  const mLon = M_LON_EQ * Math.cos((at.lat * Math.PI) / 180);
  const out = new Map<number, number>();
  const ids = only ? [...only] : sources.map((_, j) => j);
  for (const j of ids) {
    const s = sources[j];
    const c = s.coords;
    // quick reject: every vertex far beyond the cut-off (a vertex spacing above 2 km would need finer checks)
    let near = false;
    for (const p of c) if (Math.hypot((p[0] - at.lon) * mLon, (p[1] - at.lat) * M_LAT) < cutoffM + 2000) { near = true; break; }
    if (!near) continue;
    const xy = new Float64Array(c.length * 2);
    for (let i = 0; i < c.length; i++) { xy[2 * i] = (c[i][0] - at.lon) * mLon; xy[2 * i + 1] = (c[i][1] - at.lat) * M_LAT; }
    const k = lineKernel(xy, met.wind, met.stability, s.halfW, cutoffM) * s.mod * UG_PER_VEH;
    if (k > 0) out.set(j, k);
  }
  return out;
}

export interface ClosureEffect {
  /** Exhaust at the gate, NOx ug/m3, before and after the closure. */
  before: number; after: number;
  /** Change at the gate in percent (negative = less), rounded. */
  pct: number;
  /** Vehicles per hour moved onto the detour. */
  moved: number;
}

export function closureEffect(unit: ReadonlyMap<number, number>, veh: (j: number) => number, gate: readonly number[], detour: readonly number[]): ClosureEffect {
  let before = 0;
  for (const [j, u] of unit) before += u * veh(j);
  const moved = gate.reduce((s, g) => Math.max(s, veh(g)), 0); // vehicles of the gate road (its pieces carry the same flow)
  let after = before;
  for (const g of gate) after -= (unit.get(g) ?? 0) * veh(g);
  const gateSet = new Set(gate);
  for (const d of detour) if (!gateSet.has(d)) after += (unit.get(d) ?? 0) * moved;
  after = Math.max(0, after);
  return { before, after, moved, pct: before > 0 ? Math.round((after / before - 1) * 100) : 0 };
}

/**
 * Exhaust the closure adds along the detour, weighted by how many people breathe it there (harga hirup, 1 = the
 * region's median road): sum over detour roads of (rise at the road itself) x harga. Also the largest single rise.
 */
export function imposedOnDetour(selfUnit: (d: number) => number, moved: number, detour: readonly number[], harga: (d: number) => number) {
  let weighted = 0, maxRise = 0, maxAt = -1;
  for (const d of detour) {
    const rise = selfUnit(d) * moved;
    weighted += rise * harga(d);
    if (rise > maxRise) { maxRise = rise; maxAt = d; }
  }
  return { weighted, maxRise, maxAt };
}

/** One line for the school row. */
export function closureText(e: ClosureEffect, detourExtraM: number, maxRise: number, maxRoadName: string | null): string {
  if (e.moved <= 0 || e.before <= 0) return 'Jalan depan sekolah ini hampir tanpa kendaraan; menutupnya tidak mengubah asap di gerbang.';
  const at = `Asap kendaraan di gerbang ${e.pct <= 0 ? 'turun' : 'naik'} ${Math.abs(e.pct)}%`;
  const where = maxRoadName ? `, kendaraan pindah ke ${maxRoadName} (asap di sana +${maxRise.toLocaleString('id-ID', { maximumFractionDigits: 1 })} µg/m³)` : '';
  const detour = detourExtraM > 0 ? `; jalan putar ${Math.round(detourExtraM)} m lebih jauh` : '';
  return `${at}${where}${detour}.`;
}
