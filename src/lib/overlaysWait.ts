/**
 * X-W62: the app-wide overlays (offline banner, update toast, install banner, desktop nudge, command palette) all use
 * framer-motion. On a map page they are mounted after the first field draw (or OVERLAYS_FALLBACK_MS), so the motion
 * library does not compete with the coloured roads and the route on a slow link. Elsewhere they mount at once.
 */
export const OVERLAYS_FALLBACK_MS = 30_000;

/** True for the pages that open on the map: '/', '/peta' and '/home' (any query). */
export function overlaysWait(pathname: string): boolean {
  return /^\/(peta|home)?\/?$/.test(pathname);
}
