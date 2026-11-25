/**
 * N-41: drawing the coloured roads of one map tile straight onto its canvas. Replaces Leaflet.VectorGrid, which made a
 * Leaflet path object per road and re-parsed the tile on every zoom level (about 0.7 s of main-thread work per pinch on
 * a slow phone, measured with .claude/loop/lag_ukur.mjs). Here a native tile is decoded once (cached by the caller),
 * roads outside an overzoomed child tile are skipped, and all roads of one style are stroked as one path.
 */
import type { MvtTileLine } from '../nasional/mvt';

export interface GayaRuas { color: string; weight: number; opacity: number }
export interface Koord { x: number; y: number; z: number }

/** Where child tile `c` sits in its native tile (z <= maxNative): scale and offset from native units to child pixels,
 * and the child's box in native units. */
export function letakUbin(c: Koord, maxNative: number, extent: number, tileSize: number) {
  const dz = Math.max(0, c.z - maxNative);
  const k = 2 ** dz;
  const native = { z: c.z - dz, x: c.x >> dz, y: c.y >> dz };
  const s = (tileSize * k) / extent; // native unit -> child pixel
  const ox = (c.x - native.x * k) * tileSize;
  const oy = (c.y - native.y * k) * tileSize;
  return { native, s, ox, oy, box: [ox / s, oy / s, (ox + tileSize) / s, (oy + tileSize) / s] as [number, number, number, number] };
}

/** Roads grouped by style (null style = not drawn), thin before thick so main roads lie on top; features whose box
 * misses `box` (padded by half the widest line) are left out. */
export function kelompokGaya(features: MvtTileLine[], gaya: (props: MvtTileLine['props']) => GayaRuas | null, box: [number, number, number, number], padUnits: number) {
  const groups = new Map<string, { gaya: GayaRuas; feats: MvtTileLine[] }>();
  const [x0, y0, x1, y1] = [box[0] - padUnits, box[1] - padUnits, box[2] + padUnits, box[3] + padUnits];
  for (const f of features) {
    const b = f.bbox;
    if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
    const g = gaya(f.props);
    if (!g || g.opacity <= 0 || g.weight <= 0) continue;
    const key = `${g.color}|${g.weight}|${g.opacity}`;
    const e = groups.get(key);
    if (e) e.feats.push(f); else groups.set(key, { gaya: g, feats: [f] });
  }
  return [...groups.values()].sort((a, b) => a.gaya.weight - b.gaya.weight);
}

/** The 2D context calls the drawing needs (a real CanvasRenderingContext2D, or a recorder in tests). */
export interface Kanvas2D {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern; lineWidth: number; globalAlpha: number;
  lineCap: CanvasLineCap; lineJoin: CanvasLineJoin;
}

/** Draws the roads of child tile `c` from its decoded native tile; returns how many roads were stroked. */
export function gambarUbin(ctx: Kanvas2D, tile: { extent: number; features: MvtTileLine[] }, c: Koord, gaya: (props: MvtTileLine['props']) => GayaRuas | null,
  opts: { maxNative: number; tileSize: number; dpr: number; maxWeight?: number }): number {
  const { s, ox, oy, box } = letakUbin(c, opts.maxNative, tile.extent, opts.tileSize);
  ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);
  ctx.clearRect(0, 0, opts.tileSize, opts.tileSize);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let n = 0;
  for (const { gaya: g, feats } of kelompokGaya(tile.features, gaya, box, (opts.maxWeight ?? 8) / s)) {
    ctx.strokeStyle = g.color; ctx.lineWidth = g.weight; ctx.globalAlpha = g.opacity;
    ctx.beginPath();
    for (const f of feats) {
      for (const ring of f.rings) {
        ring.forEach((p, i) => (i ? ctx.lineTo(p.x * s - ox, p.y * s - oy) : ctx.moveTo(p.x * s - ox, p.y * s - oy)));
      }
      n++;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return n;
}
