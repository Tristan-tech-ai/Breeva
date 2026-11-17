import { FIELD_DRAWN_EVENT } from './source';

/** Event the field layer sends when the region in view cannot be drawn (manifest or cells failed): nothing waits longer. */
export const FIELD_FAILED_EVENT = 'breeva:field-failed';

/**
 * Last resort only. The base map and the other regions wait for the first coloured roads so they do not take the
 * bandwidth first; a 5-6 s timer used to end that wait on a slow 3G link (first roads after about 30 s), and then 250 KB
 * of base tiles and the second region competed with the road tiles (F1-51, lambat3g_urutan_2026-11-18.json). A failure
 * now ends the wait through FIELD_FAILED_EVENT, so the timer can be long.
 */
export const FIRST_DRAW_FALLBACK_MS = 40_000;

/**
 * Calls cb once: when the first coloured roads are drawn, when the field fails, or after ms. Returns a cleanup that
 * removes the listeners and the timer.
 */
export function onFirstDraw(cb: () => void, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window, ms = FIRST_DRAW_FALLBACK_MS): () => void {
  let done = false;
  const fire = () => { if (done) return; done = true; cleanup(); cb(); };
  const t = setTimeout(fire, ms);
  target.addEventListener(FIELD_DRAWN_EVENT, fire);
  target.addEventListener(FIELD_FAILED_EVENT, fire);
  function cleanup() {
    clearTimeout(t);
    target.removeEventListener(FIELD_DRAWN_EVENT, fire);
    target.removeEventListener(FIELD_FAILED_EVENT, fire);
  }
  return () => { done = true; cleanup(); };
}
