/**
 * N-41: map settings that keep zooming smooth on a phone (measured with .claude/loop/lag_ukur.mjs, 6x CPU, 412 px):
 *  - grid layers drawn by the CPU (vector basemap, coloured roads) render only after a zoom ends, not at every level a
 *    pinch passes through, and keep one ring of off-screen tiles instead of two;
 *  - no tile fade-in (Leaflet re-styles every loading tile on every frame while it fades).
 */
export const UBIN_HEMAT = { updateWhenZooming: false, keepBuffer: 1 } as const;
export const PETA_HEMAT = { fadeAnimation: false } as const;
