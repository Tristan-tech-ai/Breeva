/**
 * What a walker breathes on each edge, for the route search and for the route cards (T7, 27 Nov 2026). Pure, tested.
 *
 * The exposure of an edge is the vehicle exhaust of its field road (traffic NOx, the number the map colours in the
 * "Asap kendaraan" view and the card compares). Until T7 the search used total NO2: background plus exhaust, stored in
 * whole ug/m3, so a quiet lane (10) and a busier street (11-12) cost nearly the same and the route called cleanest
 * stayed on the street while lanes ran beside it (Tristan, Buduk, 27 Nov).
 */
import type { WalkGraph } from './walkGraph';
import { withinBudget, type RouteResult } from './router';
import { fieldMedian } from './fieldMedian';
import { EXHAUST_FLOOR } from './summary';

/** Walking speed of the route search, m/s. */
export const WALK_SPEED = 1.3;

/**
 * Reference exhaust of an hour's field: the median road, never below the level the card calls "almost none", so a quiet
 * night does not turn 0.2 against 0.1 ug/m3 into a detour. Kept per array (fieldMedian).
 */
export function exhaustRef(x: Float64Array): number {
  return Math.max(fieldMedian(x), EXHAUST_FLOOR);
}

/** Exhaust on edge e; an edge without a field road (a path, steps) counts as the median road, in cost and dose alike. */
export function walkExhaust(x: Float64Array, ref = exhaustRef(x)): (e: number) => number {
  return (e) => (Number.isFinite(x[e]) ? x[e] : ref);
}

/** The walking routes from node s to node t for the exhaust of one hour: fastest first, least exhaust last. */
export function walkRoutes(g: WalkGraph, s: number, t: number, x: Float64Array, budget?: number, tambahS?: number): RouteResult[] {
  const ref = exhaustRef(x), xOf = walkExhaust(x, ref);
  return withinBudget(g, s, t, { speed: WALK_SPEED, exposureOf: (e) => xOf(e) / ref, ...(budget == null ? {} : { budget }), ...(tambahS == null ? {} : { tambahS }) });
}
