/**
 * Page to show for a navigation that failed (no network and not in the page cache): the precached app shell, so any
 * route of the single-page app (for example a new /peta?rute=... link) still opens and computes its route from the
 * cached region files; the offline page only when the shell itself is missing. `match` is workbox's matchPrecache,
 * which finds precached files despite their revision parameter (a plain caches.match does not). Task F2-09.
 */
export const SHELL = '/index.html';
export const OFFLINE_PAGE = '/offline.html';

export async function offlineDocument(match: (url: string) => Promise<Response | undefined>): Promise<Response | undefined> {
  return (await match(SHELL)) ?? (await match(OFFLINE_PAGE));
}
