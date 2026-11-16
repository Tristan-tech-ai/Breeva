/**
 * Tapping a road of the static field. VectorGrid's own canvas hit test finds no road under the pointer with Leaflet 1.9
 * here (L.Canvas.Tile._onClick runs, every _containsPoint is false; checked 16 Nov 2026), so the layer keeps the decoded
 * tiles and finds the nearest line itself, in tile units. Pure functions, no Leaflet.
 */

export interface TilePoint { x: number; y: number }
export interface TileFeature { geometry: TilePoint[][]; properties: Record<string, unknown>; extent?: number }

/** Fractional tile coordinates of a point at zoom z (Web Mercator, slippy-map numbering). */
export function tileFraction(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const lr = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(lr)) / Math.PI) / 2) * n };
}

function segDist(px: number, py: number, a: TilePoint, b: TilePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Nearest line feature to (px, py) within tol (all in tile units), or null. */
export function nearestFeature(features: TileFeature[], px: number, py: number, tol: number): { feature: TileFeature; dist: number } | null {
  let best: { feature: TileFeature; dist: number } | null = null;
  for (const f of features) {
    for (const line of f.geometry) {
      for (let k = 0; k + 1 < line.length; k++) {
        const d = segDist(px, py, line[k], line[k + 1]);
        if (d <= tol && (!best || d < best.dist)) best = { feature: f, dist: d };
      }
    }
  }
  return best;
}

/** Tile units per screen pixel for a tile of zoom z drawn at map zoom mapZoom (256 px tiles). */
export function unitsPerPixel(extent: number, z: number, mapZoom: number): number {
  return extent / 256 / 2 ** (mapZoom - z);
}
