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

/** Event the route layer sends when a route request has finished, with routes or with an error (F1-53). */
export const ROUTE_SETTLED_EVENT = 'breeva:route-settled';

/**
 * Last resort while a route link waits for its first route. On a slow 3G link that route needs the 1 MB walking graph
 * and arrived after about 50 s (lambat3g_worker_2026-11-18.json); a failure ends the wait through ROUTE_SETTLED_EVENT.
 */
export const ROUTE_FALLBACK_MS = 75_000;

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Calls cb once: when the first coloured roads are drawn (or the field fails) and, with waitRoute, also the first route
 * of a route link has finished (F1-53: the base map and the other regions then leave a slow link to the router's
 * files, since the route is what the visitor opened the link for); or after ms. Returns a cleanup that removes the
 * listeners and the timer.
 */
export function onFirstDraw(cb: () => void, target: Target = window, ms?: number, waitRoute = false): () => void {
  let done = false;
  let drawn = false;
  let routed = !waitRoute;
  const check = () => { if (done || !drawn || !routed) return; done = true; cleanup(); cb(); };
  const onDraw = () => { drawn = true; check(); };
  const onRoute = () => { routed = true; check(); };
  const onTimeout = () => { drawn = true; routed = true; check(); };
  const t = setTimeout(onTimeout, ms ?? (waitRoute ? ROUTE_FALLBACK_MS : FIRST_DRAW_FALLBACK_MS));
  target.addEventListener(FIELD_DRAWN_EVENT, onDraw);
  target.addEventListener(FIELD_FAILED_EVENT, onDraw);
  if (waitRoute) target.addEventListener(ROUTE_SETTLED_EVENT, onRoute);
  function cleanup() {
    clearTimeout(t);
    target.removeEventListener(FIELD_DRAWN_EVENT, onDraw);
    target.removeEventListener(FIELD_FAILED_EVENT, onDraw);
    target.removeEventListener(ROUTE_SETTLED_EVENT, onRoute);
  }
  return () => { done = true; cleanup(); };
}

/** Resolves when the first route of a route link has finished, or after ms (see onFirstDraw). */
export function routeSettled(target: Target = window, ms = ROUTE_FALLBACK_MS): Promise<void> {
  return new Promise((resolve) => {
    const go = () => { clearTimeout(t); target.removeEventListener(ROUTE_SETTLED_EVENT, go); resolve(); };
    const t = setTimeout(go, ms);
    target.addEventListener(ROUTE_SETTLED_EVENT, go);
  });
}
