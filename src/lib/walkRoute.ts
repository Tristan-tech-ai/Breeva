/** A stored walk as read from Supabase, only the fields the route line needs. */
export interface WalkRouteRow {
  route_polyline?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
}

/**
 * The line to draw for a stored walk: its saved polyline (objects {lat,lng} or [lat,lng] pairs), else the straight line
 * from origin to destination. X-W60: the page used to test the polyline against stale state, so the straight line
 * always replaced the saved route.
 */
export function walkRouteCoords(row: WalkRouteRow): [number, number][] {
  if (row.route_polyline) {
    try {
      const parsed = JSON.parse(row.route_polyline);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return parsed.map((p: { lat: number; lng: number } | [number, number]) => (Array.isArray(p) ? (p as [number, number]) : [p.lat, p.lng]));
      }
    } catch { /* not JSON: fall back to the straight line */ }
  }
  if (row.origin_lat && row.destination_lat) {
    return [[row.origin_lat, row.origin_lng ?? 0], [row.destination_lat, row.destination_lng ?? 0]];
  }
  return [];
}
