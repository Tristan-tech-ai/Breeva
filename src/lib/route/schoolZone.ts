/**
 * School breathing zone for motor routes (task F3-07): during the school entry and exit hours, a motor route does not
 * use a minor street (unclassified, residential, living_street, service, road) that passes within radius_m of a school
 * or kindergarten, except the frontage of a school that is itself the trip's start or destination (a parent dropping a
 * child off). Through roads (tertiary and above) stay usable: through traffic has to run somewhere, closing them too
 * left 184 of 200 motor trips in Kota Bogor without a route and closing secondary-and-above only still 62 (bench of
 * 16 Nov); harga hirup already weighs the schools along them. When a trip has no route otherwise, the zone is lifted
 * inside the access zone of its start and destination only, and the route says so. Outside those hours the edges are
 * allowed.
 *
 * School points per region come from the BSZ1 file (scripts/field/build-schools.mts, from OpenStreetMap), served next
 * to the walking graph at graphs/<geometry>/<name>_schools.json.
 */
import type { WalkGraph } from './walkGraph';
import type { RouteResult, SearchOptions } from './router';
import { accessZone, motorRoute, type CostInputs, type Mode } from './cost';

export interface SchoolFile {
  format: 'BSZ1';
  name: string;
  geometry: string;
  /** Local time zone of the region, hours east of UTC. */
  tz: number;
  radius_m: number;
  /** Active windows in local minutes after midnight, [start, end). */
  hours: Array<[number, number]>;
  /** [lat, lon] of every school and kindergarten. */
  points: Array<[number, number]>;
  /** Version 2: OSM name ('' when unnamed) and kind of each point, aligned with points. */
  version?: number;
  names?: string[];
  kinds?: Array<'school' | 'kindergarten'>;
}

/** Entry 06.30-07.30 and exit 12.00-13.30 local time (decision of 16 Nov). */
export const SCHOOL_HOURS: Array<[number, number]> = [[390, 450], [720, 810]];
export const SCHOOL_RADIUS_M = 50;
/** A school within this straight-line distance of the start or destination is the trip's own school. */
export const OWN_SCHOOL_M = 150;

const M_LAT = 110574;
/** Classes the school zone never closes (through roads). */
export const ARTERIAL = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);

/** Local minutes after midnight of an instant in a zone tz hours east of UTC. */
export function localMinutes(atMs: number, tz: number): number {
  const m = Math.floor(atMs / 60000) + tz * 60;
  return ((m % 1440) + 1440) % 1440;
}

/**
 * Departure instant from a local clock time "HH:MM" (the ?berangkat= link parameter, for demonstrating the school
 * zone outside school hours): that time on the region's current local date. Invalid text gives nowMs.
 */
export function localTimeToMs(hhmm: string | null | undefined, tz: number, nowMs: number): number {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(hhmm ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return nowMs;
  const dayStart = nowMs - localMinutes(nowMs, tz) * 60000 - (nowMs % 60000);
  return dayStart + (Number(m[1]) * 60 + Number(m[2])) * 60000;
}

export function schoolActive(f: Pick<SchoolFile, 'tz' | 'hours'>, atMs: number): boolean {
  const m = localMinutes(atMs, f.tz);
  return f.hours.some(([a, b]) => m >= a && m < b);
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}

/**
 * For every directed edge, the index of the nearest school whose point lies within radiusM of the edge's polyline, or
 * -1. Local equirectangular metres; schools bucketed on a grid of radiusM-sized cells.
 */
export function schoolEdges(g: WalkGraph, points: Array<[number, number]>, radiusM = SCHOOL_RADIUS_M): Int32Array {
  const out = new Int32Array(g.m).fill(-1);
  if (!points.length) return out;
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  const cell = Math.max(radiusM, 1);
  // numeric cell keys, unique while |cy| < 2^20 (any latitude with cells of 10 m or more; the school radius is 50 m);
  // string keys were most of the first motor route's time on a phone (F3-21). Same cells, same order of schools, so
  // the same school for every edge.
  const key = (cx: number, cy: number) => cx * 2097152 + cy;
  const grid = new Map<number, number[]>();
  const px = points.map((p) => p[1] * mLon), py = points.map((p) => p[0] * M_LAT);
  points.forEach((_, k) => { const kk = key(Math.floor(px[k] / cell), Math.floor(py[k] / cell)); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k); });
  const r2 = radiusM * radiusM;
  let xs = new Float64Array(16), ys = new Float64Array(16);
  for (let u = 0; u < g.n; u++) {
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const c = g.edgeCoords(e, u);
      const n = c.length;
      if (n > xs.length) { xs = new Float64Array(2 * n); ys = new Float64Array(2 * n); }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let q = 0; q < n; q++) {
        const x = c[q][0] * mLon, y = c[q][1] * M_LAT;
        xs[q] = x; ys[q] = y;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      let best = r2, bestK = -1;
      for (let cx = Math.floor((x0 - radiusM) / cell); cx <= Math.floor((x1 + radiusM) / cell); cx++) {
        for (let cy = Math.floor((y0 - radiusM) / cell); cy <= Math.floor((y1 + radiusM) / cell); cy++) {
          const ks = grid.get(key(cx, cy));
          if (!ks) continue;
          for (const k of ks) {
            for (let q = 1; q < n; q++) {
              const d2 = segDist2(px[k], py[k], xs[q - 1], ys[q - 1], xs[q], ys[q]);
              if (d2 <= best) { best = d2; bestK = k; }
            }
          }
        }
      }
      out[e] = bestK;
    }
  }
  return out;
}

/**
 * The trip's own schools, whose frontage stays usable: schools within ownM (straight line) of node s or node t, and
 * schools along an edge leaving s or t (the start and destination edges; both directions are in the graph).
 */
export function ownSchools(g: WalkGraph, points: Array<[number, number]>, edgeSchool: Int32Array, s: number, t: number, ownM = OWN_SCHOOL_M): Set<number> {
  const own = new Set<number>();
  for (const u of [s, t]) {
    const la = g.nodeLat(u), lo = g.nodeLon(u), mLon = M_LAT * Math.cos((la * Math.PI) / 180);
    points.forEach(([plat, plon], k) => { if (Math.hypot((plon - lo) * mLon, (plat - la) * M_LAT) <= ownM) own.add(k); });
    for (let e = g.off[u]; e < g.off[u + 1]; e++) if (edgeSchool[e] >= 0) own.add(edgeSchool[e]);
  }
  return own;
}

/**
 * The edge filter of the school zone for one trip, or null when the zone is not active at atMs. An edge is refused
 * when it passes a school that is not the trip's own, unless it is an arterial (strict: arterials too, kept only to
 * measure why the rule spares them).
 */
export function schoolFilter(
  g: WalkGraph, f: SchoolFile, edgeSchool: Int32Array, s: number, t: number, atMs: number, strict = false,
): ((e: number) => boolean) | null {
  if (!schoolActive(f, atMs)) return null;
  const own = ownSchools(g, f.points, edgeSchool, s, t);
  return (e) => edgeSchool[e] < 0 || own.has(edgeSchool[e]) || (!strict && ARTERIAL.has(g.highway(e)));
}

/** Loaded school zone of a region: the BSZ1 file and the school of every edge. */
export interface SchoolZone { file: SchoolFile; edgeSchool: Int32Array }

export type SchoolState = 'off' | 'kept' | 'lifted-near-ends';

/**
 * Motor route with the school zone at atMs: kept when possible, otherwise lifted inside the 1500 m access zone of the
 * start and destination (never beyond), otherwise null.
 */
export function motorRouteAt(
  route: (g: WalkGraph, s: number, t: number, w: number, o: SearchOptions) => RouteResult | null,
  g: WalkGraph, mode: Mode, s: number, t: number, inp: CostInputs, zone: SchoolZone | null, atMs: number, emergency = false,
): { route: RouteResult; accessM: number; school: SchoolState } | null {
  const allow = zone ? schoolFilter(g, zone.file, zone.edgeSchool, s, t, atMs) : null;
  if (!allow) { const r = motorRoute(route, g, mode, s, t, inp, emergency); return r && { ...r, school: 'off' }; }
  const kept = motorRoute(route, g, mode, s, t, { ...inp, allow }, emergency);
  if (kept) return { ...kept, school: 'kept' };
  const ends = accessZone(g, s, t, 1500);
  const lifted = motorRoute(route, g, mode, s, t, { ...inp, allow: (e) => allow(e) || ends[e] === 1 }, emergency);
  return lifted && { ...lifted, school: 'lifted-near-ends' };
}
