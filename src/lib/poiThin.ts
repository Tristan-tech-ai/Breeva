/**
 * POI declutter (F1-70). With the complete POI packs (thousands of places per town) the map showed dozens of icons,
 * labels and numbered cluster bubbles at z17 (Tristan, 18 Nov 2026: 'berantakan'). Now at most MAX_RENDER_POINTS markers,
 * at least MIN_GAP_PX apart, the most important first; no cluster bubbles; the rest appear as the user zooms in.
 * Pure (no Leaflet), so it is tested in node.
 */
export const MAX_RENDER_POINTS = 40;
export const MIN_GAP_PX = 44;

/** Web Mercator pixel position at zoom z (256 px tiles). */
function px(lng: number, lat: number, z: number): [number, number] {
  const s = 256 * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

/** Keep the most important points (lowest priority number, then shorter name), each at least gapPx from every kept one. */
export function thinPoints<T extends { lng: number; lat: number; _priority: number; poi: { name: string; id: string } }>(
  points: T[], zoom: number, gapPx = MIN_GAP_PX, max = MAX_RENDER_POINTS,
): T[] {
  const sorted = [...points].sort((a, b) => a._priority - b._priority || a.poi.name.length - b.poi.name.length || (a.poi.id < b.poi.id ? -1 : 1));
  const kept: Array<{ p: T; x: number; y: number }> = [];
  for (const p of sorted) {
    if (kept.length >= max) break;
    const [x, y] = px(p.lng, p.lat, zoom);
    if (kept.every((k) => (k.x - x) ** 2 + (k.y - y) ** 2 >= gapPx * gapPx)) kept.push({ p, x, y });
  }
  return kept.map((k) => k.p);
}
