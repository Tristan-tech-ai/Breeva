/**
 * EcoPoints, CO2 and streak of a completed walk, computed on the device for guests (no account). Mirrors the server
 * exactly: the complete_walk RPC (supabase/migration_009_audit_fixes.sql), update_user_streak (same file) and the
 * anti-cheat checks of api/walks/complete.ts. Pure; tested in tests/guest-points.test.ts.
 */

export interface WalkPoint { lat: number; lng: number; timestamp?: string }

/**
 * Hundredths of a kilometre the way complete_walk stores them: distance_meters is an INTEGER and
 * v_distance_km DECIMAL(10,2) rounds m / 1000 to two decimals (half away from zero).
 */
function centiKm(distanceMeters: number): number {
  const m = Math.max(0, Math.round(distanceMeters));
  return Math.round(m / 10);
}

/**
 * complete_walk: GREATEST(1, ROUND(km * 10)), then +ROUND(points * 0.5) when the route-mean AQI is <= 50 or
 * +ROUND(points * 0.25) when it is <= 100. No AQI (null) = no bonus.
 */
export function walkEcoPoints(distanceMeters: number, avgAqi?: number | null): number {
  let points = Math.max(1, Math.round(centiKm(distanceMeters) / 10));
  if (avgAqi != null && Number.isFinite(avgAqi)) {
    const aqi = Math.round(avgAqi); // p_avg_aqi is an INTEGER parameter
    if (aqi <= 50) points += Math.round(points * 0.5);
    else if (aqi <= 100) points += Math.round(points * 0.25);
  }
  return points;
}

/** complete_walk: ROUND(km * 120) grams of CO2 avoided against driving. */
export function walkCo2Grams(distanceMeters: number): number {
  return Math.round((centiKm(distanceMeters) * 12) / 10);
}

/** Distance in km as complete_walk adds it to users.total_distance_km (two decimals). */
export function walkKm(distanceMeters: number): number {
  return centiKm(distanceMeters) / 100;
}

function haversine(a: WalkPoint, b: WalkPoint): number {
  const R = 6371e3;
  const f1 = (a.lat * Math.PI) / 180, f2 = (b.lat * Math.PI) / 180;
  const df = ((b.lat - a.lat) * Math.PI) / 180, dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** validateWalk of api/walks/complete.ts: the server refuses these walks (no points). */
export function validateWalk(distanceMeters: number, durationSeconds: number, points?: WalkPoint[]): { valid: boolean; reason?: string } {
  if (!(distanceMeters > 0) || !(durationSeconds > 0)) return { valid: false, reason: 'Invalid distance or duration' };
  const avg = distanceMeters / durationSeconds;
  if (avg > 3) return { valid: false, reason: 'Speed too high for walking' };
  if (avg < 0.1) return { valid: false, reason: 'Speed too low' };
  if (points && points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const dt = (new Date(points[i].timestamp ?? '').getTime() - new Date(points[i - 1].timestamp ?? '').getTime()) / 1000;
      if (dt > 0 && haversine(points[i - 1], points[i]) / dt > 10) return { valid: false, reason: 'Suspicious movement detected' };
    }
  }
  return { valid: true };
}

/** Calendar day "YYYY-MM-DD" one day before `day`. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * update_user_streak: the same day keeps the streak, the next day continues it, a gap (or the first walk) restarts
 * it at 1; the longest streak follows.
 */
export function nextStreak(
  s: { current_streak: number; longest_streak: number; last_walk_date: string | null }, today: string,
): { current_streak: number; longest_streak: number } {
  let current: number;
  if (s.last_walk_date === today) current = s.current_streak || 0;
  else if (s.last_walk_date && s.last_walk_date === dayBefore(today)) current = (s.current_streak || 0) + 1;
  else current = 1;
  return { current_streak: current, longest_streak: Math.max(current, s.longest_streak || 0) };
}
