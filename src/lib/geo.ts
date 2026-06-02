// src/lib/geo.ts
// Pure geo helpers for navigation: bearing, snap-to-path, progress-along-route,
// look-ahead camera target, off-route + arrival geofence, path splitting.
// Self-contained (own haversine) so it stays dependency-light.
import type { Coordinate } from '../types';

const R = 6371000; // Earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees [0,360) — 0=N, 90=E. */
export function bearing(a: Coordinate, b: Coordinate): number {
  const f1 = toRad(a.lat), f2 = toRad(b.lat), dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Circular EMA to de-jitter a heading. alpha 0..1 (higher = snappier). */
export function smoothHeading(prev: number | null | undefined, next: number, alpha = 0.35): number {
  if (prev == null || Number.isNaN(prev)) return next;
  const diff = ((next - prev + 540) % 360) - 180; // shortest signed delta
  return (prev + alpha * diff + 360) % 360;
}

// Local equirectangular projection around a reference point (metres) for fast segment math.
function toXY(p: Coordinate, ref: Coordinate): { x: number; y: number } {
  return {
    x: toRad(p.lng - ref.lng) * Math.cos(toRad(ref.lat)) * R,
    y: toRad(p.lat - ref.lat) * R,
  };
}

export function pathLength(path: Coordinate[]): number {
  let d = 0;
  for (let i = 0; i < path.length - 1; i++) d += haversine(path[i], path[i + 1]);
  return d;
}

export interface NearestOnPath {
  point: Coordinate;
  segIndex: number;
  perpMeters: number;
  distAlongMeters: number;
}

/** Project pos onto the nearest segment of `path`, with distance travelled along the path. */
export function nearestOnPath(pos: Coordinate, path: Coordinate[]): NearestOnPath | null {
  if (path.length < 2) return null;
  let best: NearestOnPath | null = null;
  let cumBefore = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    const p = toXY(pos, A), b = toXY(B, A);
    const segLen2 = b.x * b.x + b.y * b.y || 1e-9;
    let t = (p.x * b.x + p.y * b.y) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const perp = Math.hypot(p.x - t * b.x, p.y - t * b.y);
    const segLen = haversine(A, B);
    if (!best || perp < best.perpMeters) {
      best = {
        point: { lat: A.lat + t * (B.lat - A.lat), lng: A.lng + t * (B.lng - A.lng) },
        segIndex: i,
        perpMeters: perp,
        distAlongMeters: cumBefore + t * segLen,
      };
    }
    cumBefore += segLen;
  }
  return best;
}

export interface RouteProgress {
  fraction: number;
  metersDone: number;
  metersRemaining: number;
  segIndex: number;
  snapped: Coordinate;
  perpMeters: number;
}
export function routeProgress(pos: Coordinate, path: Coordinate[], totalMeters?: number): RouteProgress | null {
  const near = nearestOnPath(pos, path);
  if (!near) return null;
  const total = totalMeters && totalMeters > 0 ? totalMeters : pathLength(path);
  const done = Math.min(near.distAlongMeters, total);
  return {
    fraction: total > 0 ? Math.min(1, done / total) : 0,
    metersDone: done,
    metersRemaining: Math.max(0, total - done),
    segIndex: near.segIndex,
    snapped: near.point,
    perpMeters: near.perpMeters,
  };
}

/** A point `aheadMeters` further along the path from a starting point/segment — camera look-ahead. */
export function lookAheadPoint(path: Coordinate[], fromPoint: Coordinate, fromSeg: number, aheadMeters: number): Coordinate {
  let remaining = aheadMeters;
  let cur = fromPoint;
  for (let i = fromSeg; i < path.length - 1; i++) {
    const next = path[i + 1];
    const d = haversine(cur, next);
    if (d >= remaining) {
      const t = remaining / (d || 1);
      return { lat: cur.lat + t * (next.lat - cur.lat), lng: cur.lng + t * (next.lng - cur.lng) };
    }
    remaining -= d;
    cur = next;
  }
  return path[path.length - 1] ?? fromPoint;
}

/** Split a path at a fraction (0..1) → [traveled, remaining] for dimmed/vivid rendering. */
export function splitPathAtFraction(path: Coordinate[], fraction: number): { traveled: Coordinate[]; remaining: Coordinate[] } {
  if (path.length < 2 || fraction <= 0) return { traveled: [], remaining: path };
  if (fraction >= 1) return { traveled: path, remaining: [] };
  const target = pathLength(path) * fraction;
  let cum = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    const d = haversine(A, B);
    if (cum + d >= target) {
      const t = (target - cum) / (d || 1);
      const mid = { lat: A.lat + t * (B.lat - A.lat), lng: A.lng + t * (B.lng - A.lng) };
      return { traveled: [...path.slice(0, i + 1), mid], remaining: [mid, ...path.slice(i + 1)] };
    }
    cum += d;
  }
  return { traveled: path, remaining: [] };
}

export const isOffRoute = (perpMeters: number, threshold = 25): boolean => perpMeters > threshold;
export const withinGeofence = (pos: Coordinate, dest: Coordinate, radiusMeters = 30): boolean =>
  haversine(pos, dest) <= radiusMeters;
