/**
 * Area asked from the station proxy (/api/vayu/waqi-stations). The map used to send its exact view, so the server log
 * held the area around a student's route; the view is now widened outward to a coarse grid of CELL_DEG degrees
 * (0.25 deg, about 27 km), which covers a whole city, and the same cell answers every pan inside it from the cache.
 * (Task F1-22, 17 Nov 2026.)
 */
export const CELL_DEG = 0.25;

export interface Bbox { south: number; west: number; north: number; east: number }

const r = (x: number) => Math.round(x * 1e6) / 1e6;

export function coarseBbox(view: Bbox, cell = CELL_DEG): Bbox {
  const lo = (x: number) => r(Math.floor(x / cell) * cell);
  const hi = (x: number) => { const c = Math.ceil(x / cell) * cell; return r(c === x ? c + cell : c); };
  return { south: lo(view.south), west: lo(view.west), north: hi(view.north), east: hi(view.east) };
}

/** Query value in the proxy's order: south,west,north,east. */
export const bboxParam = (b: Bbox) => `${b.south},${b.west},${b.north},${b.east}`;

/**
 * M-U17: from this zoom a station is a badge with its number; zoomed further out it is a small dot on the map's canvas
 * (a badge is 72 px wide: a province of them covers the map, and each is a DOM element the phone has to move).
 */
export const STATION_BADGE_ZOOM = 10;
export const stationAsBadge = (zoom: number): boolean => zoom >= STATION_BADGE_ZOOM;
