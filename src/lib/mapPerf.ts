/**
 * N-41: map settings that keep zooming smooth on a phone (measured with .claude/loop/lag_ukur.mjs, 6x CPU, 412 px):
 *  - grid layers drawn by the CPU (vector basemap, coloured roads) render only after a zoom ends, not at every level a
 *    pinch passes through, and keep one ring of off-screen tiles instead of two;
 *  - no tile fade-in (Leaflet re-styles every loading tile on every frame while it fades).
 */
export const UBIN_HEMAT = { updateWhenZooming: false, keepBuffer: 1 } as const;
export const PETA_HEMAT = { fadeAnimation: false } as const;

/** N-41: pixel ratio for the vector basemap tiles. Phones are mostly DPR 3: each tile drawn on the main thread then has
 * 9x the pixels of DPR 1; capped at 2 it has 4x (55% fewer pixels to fill per zoom), still sharp. */
export function dprPetaDasar(dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  return Math.min(2, Math.max(1, dpr));
}
