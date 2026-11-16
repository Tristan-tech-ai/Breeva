/**
 * Route cost for every mode (routing externality, decision of 14 Nov):
 *
 *   c_e = t_e * (1 + w * E_e + lambda * eps_m * H_e)
 *
 * E_e own exposure of the edge (field NO2 over the region's median), H_e harga hirup (1 = the region's median road),
 * eps_m the mode's emission share (0 walking and cycling). Motor modes also keep the zona napas: no local street
 * (residential, living_street, service, unclassified gang) except inside the access zone around the start and the
 * destination, and never footways, paths or steps; during school hours also no edge past a school that is not the trip's
 * own (schoolZone.ts, passed as CostInputs.allow). The emergency option has no points and w = lambda = 0 (fastest),
 * and still keeps the zona napas.
 */
import type { WalkGraph } from './walkGraph';
import type { SearchOptions } from './router';

export type Mode = 'walk' | 'motor' | 'car';

/** Emission share per kilometre relative to a motorcycle [P]: a placeholder until per-class fleet factors are wired. */
export const EMISSION_SHARE: Record<Mode, number> = { walk: 0, motor: 1, car: 1.5 };
/** Weight of the imposed exposure against time (lambda). */
export const LAMBDA = 1;
/** Network distance around start and destination where a motor route may use local streets (access and egress). */
export const ACCESS_M = 500;

const LOCAL = new Set(['residential', 'living_street', 'service']);
const NO_MOTOR = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track']);
/** Motor speed by class, km/h [P]: typical urban Indonesian speeds, only used to rank routes. */
const KMH: Record<string, number> = {
  motorway: 60, motorway_link: 40, trunk: 40, trunk_link: 30, primary: 35, primary_link: 25, secondary: 30, secondary_link: 25,
  tertiary: 25, tertiary_link: 20, unclassified: 20, residential: 15, living_street: 10, service: 10, road: 20,
};
export const MOTOR_TOP_SPEED = 60 / 3.6;

export function isLocal(g: WalkGraph, e: number): boolean { return LOCAL.has(g.highway(e)); }
export function motorAllowedClass(g: WalkGraph, e: number): boolean { return !NO_MOTOR.has(g.highway(e)) && !g.isSteps(e); }
export function motorSpeed(g: WalkGraph, e: number): number { return (KMH[g.highway(e)] ?? 20) / 3.6; }

/**
 * Edges within maxM of network distance from node s or node t (Dijkstra by length over the motor-allowed edges):
 * the access zone in which local streets stay usable.
 */
export function accessZone(g: WalkGraph, s: number, t: number, maxM = ACCESS_M): Uint8Array {
  const inZone = new Uint8Array(g.m);
  for (const src of [s, t]) {
    const dist = new Map<number, number>([[src, 0]]);
    const frontier: Array<[number, number]> = [[0, src]];
    while (frontier.length) {
      frontier.sort((a, b) => b[0] - a[0]);
      const [du, u] = frontier.pop()!;
      if (du > (dist.get(u) ?? Infinity)) continue;
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        if (!motorAllowedClass(g, e)) continue;
        const nd = du + g.lenDm[e] / 10;
        // an edge whose start lies within maxM: with both directions in the graph this covers leaving the start and
        // arriving at the destination
        if (du <= maxM) inZone[e] = 1;
        const v = g.target[e];
        if (nd <= maxM && nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); frontier.push([nd, v]); }
      }
    }
  }
  return inZone;
}

export interface CostInputs {
  /** Field NO2 of each edge (NaN where the edge has no field road). */
  no2: Float64Array;
  /** Harga hirup index of each edge (NaN where unknown). */
  harga?: Float64Array;
  /** Further edge filter of this trip for motor modes (the school zone during school hours, schoolZone.ts). */
  allow?: (e: number) => boolean;
}

function medianOf(a: Float64Array): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

/** Router options for a mode and a trip from node s to node t. emergency: no points, fastest, zona napas kept. */
export function optionsFor(g: WalkGraph, mode: Mode, s: number, t: number, inp: CostInputs, emergency = false, accessM = ACCESS_M): SearchOptions {
  const medN = medianOf(inp.no2);
  const exposureOf = (e: number) => (Number.isFinite(inp.no2[e]) ? inp.no2[e] / medN : 1);
  if (mode === 'walk') return { speed: 1.3, exposureOf };
  const zone = accessZone(g, s, t, accessM);
  const eps = EMISSION_SHARE[mode];
  const h = inp.harga;
  const extra = inp.allow;
  return {
    speed: MOTOR_TOP_SPEED,
    speedOf: (e) => motorSpeed(g, e),
    allowed: (e) => motorAllowedClass(g, e) && (!isLocal(g, e) || zone[e] === 1) && (!extra || extra(e)),
    exposureOf,
    imposedOf: (e) => eps * (h && Number.isFinite(h[e]) ? h[e] : 1),
    lambda: emergency ? 0 : LAMBDA,
  };
}

/** True when node u has an edge a motor vehicle may use (a start or destination for motor trips must have one). */
export function motorNode(g: WalkGraph, u: number): boolean {
  for (let e = g.off[u]; e < g.off[u + 1]; e++) if (motorAllowedClass(g, e)) return true;
  return false;
}

/**
 * Motor route with the zona napas, widening the access zone (500 m, then 1500 m) when the start or destination lies
 * deeper in local streets than that. accessM says which zone was needed.
 */
export function motorRoute(
  route: (g: WalkGraph, s: number, t: number, w: number, o: SearchOptions) => import('./router').RouteResult | null,
  g: WalkGraph, mode: Mode, s: number, t: number, inp: CostInputs, emergency = false,
) {
  for (const accessM of [ACCESS_M, 1500]) {
    const o = optionsFor(g, mode, s, t, inp, emergency, accessM);
    const r = route(g, s, t, emergency ? 0 : 1, o);
    if (r) return { route: r, accessM };
  }
  return null;
}
