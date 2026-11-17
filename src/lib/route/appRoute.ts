/**
 * The in-app map (/home) on the on-device engine of /peta (task F1-18): which destinations route on the device, where
 * the route starts, and the chosen on-device route as the app's Route for walk tracking. Pure; tested in
 * tests/app-route.test.ts.
 */
import { FIELD_REGIONS, type FieldRegion } from '../field/source';
import type { WalkRoute } from './client';
import type { Route, TransportMode } from '../../types';

export interface P { lat: number; lng: number }

/** The field region containing the point (bounds as in FIELD_REGIONS), or null. */
export function fieldRegionOf(p: P | null | undefined): FieldRegion | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return FIELD_REGIONS.find((r) => r.bounds[0][0] <= p.lat && p.lat <= r.bounds[1][0] && r.bounds[0][1] <= p.lng && p.lng <= r.bounds[1][1]) ?? null;
}

/** The user's position starts the route when it lies in the destination's region; otherwise null (the user taps). */
export function deviceRouteStart(gps: P | null | undefined, dest: P | null | undefined): P | null {
  const r = fieldRegionOf(dest);
  if (!r || !gps || fieldRegionOf(gps) !== r) return null;
  return { lat: gps.lat, lng: gps.lng };
}

/** On-device graphs exist for walking and motorbike only: every other mode of the old selector has no device route. */
export function routeModeFor(t: TransportMode): 'walk' | 'motor' {
  return t === 'motorcycle' ? 'motor' : 'walk';
}

export function transportFor(m: 'walk' | 'motor'): TransportMode {
  return m === 'motor' ? 'motorcycle' : 'walking';
}

/**
 * An on-device route as the app's Route, so the existing walk tracking (progress bar, remaining distance, arrival,
 * walked part of the line) follows its polyline. No turn-by-turn instructions: the device graph has none.
 */
export function deviceRouteAsRoute(r: WalkRoute, o: {
  id: string; userId: string; cleanest: boolean; avgAqi: number; points: number; now?: Date;
}): Route {
  const waypoints = r.coords.map(([lon, lat]) => ({ lat, lng: lon }));
  const first = waypoints[0] ?? { lat: 0, lng: 0 };
  const last = waypoints[waypoints.length - 1] ?? first;
  return {
    id: o.id,
    user_id: o.userId,
    start_point: first,
    end_point: last,
    waypoints,
    instructions: [],
    distance_meters: Math.round(r.lengthM),
    duration_seconds: Math.round(r.timeS),
    avg_aqi: o.avgAqi,
    eco_points_earned: o.points,
    route_type: o.cleanest ? 'eco' : 'fast',
    created_at: (o.now ?? new Date()).toISOString(),
    aqi_estimate: 'model',
  };
}

/**
 * The "Pakai lokasiku" button on /peta (task F3-14): the phone's position becomes the start of the route to the chosen
 * school when both lie in the same field region, and the note says what happened when it cannot.
 */
export function locationStart(gps: P | null | undefined, dest: P | null | undefined, error?: string | null): { start: P | null; note: string | null } {
  if (error) return { start: null, note: 'Lokasi tidak bisa dipakai (izin ditolak atau tidak tersedia). Ketuk titik berangkat di peta.' };
  if (!gps) return { start: null, note: null };
  if (!dest) return { start: null, note: 'Lokasimu akan dipakai sebagai titik berangkat setelah sekolah tujuan dipilih.' };
  const start = deviceRouteStart(gps, dest);
  return start
    ? { start, note: 'Berangkat dari lokasimu sekarang. Ketuk peta untuk titik berangkat lain.' }
    : { start: null, note: 'Lokasimu di luar wilayah sekolah ini. Ketuk titik berangkat di peta.' };
}
