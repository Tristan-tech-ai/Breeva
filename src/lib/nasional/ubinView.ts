/** N-21: which national road tiles a map view needs, and where the pilot regions take over. Pure. */
import { FIELD_REGIONS } from '../field/source';
import { tileOf } from './mvt';

/** Zoom from which the phone computes exhaust per road outside the pilot regions (N-21). */
export const NATIONAL_MIN_ZOOM = 13;
const TILE_Z = 14;

/** z14 tiles covering the map view (at most 30, the centre first). */
export function viewTiles(b: { west: number; south: number; east: number; north: number }, centre: { lon: number; lat: number }, max = 30): Array<[number, number, number]> {
  const [x0, y0] = tileOf(b.west, b.north, TILE_Z), [x1, y1] = tileOf(b.east, b.south, TILE_Z), [cx, cy] = tileOf(centre.lon, centre.lat, TILE_Z);
  const out: Array<[number, number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([TILE_Z, x, y]);
  return out.sort((a, b) => Math.hypot(a[1] - cx, a[2] - cy) - Math.hypot(b[1] - cx, b[2] - cy)).slice(0, max);
}

/** True when the point lies in a pilot region (those show the cloud field instead). */
export const inPilot = (lat: number, lon: number) => FIELD_REGIONS.some((r) => lat >= r.bounds[0][0] && lat <= r.bounds[1][0] && lon >= r.bounds[0][1] && lon <= r.bounds[1][1]);

