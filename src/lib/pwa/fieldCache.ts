/**
 * Offline map for the static field (task F2-12, for the offline demo at the final): which CloudFront files the service
 * worker keeps, and how it keeps the PMTiles geometry. The map reads PMTiles with HTTP range requests and the Cache API
 * refuses partial (206) responses, so each range the map actually read is stored as a whole response under its own
 * key and served back as a 206 with exactly those bytes. Nothing is fetched ahead: an area works offline once it has
 * been seen online (the OSM basemap is not prefetched either; its tile policy forbids that). Pure except cachedRange,
 * which takes the cache and fetch it uses, so it is tested with fakes.
 */

export type FieldKind = 'geometry' | 'manifest' | 'cells' | 'harga';

/** The field file a URL names, or null. Only other origins (the CloudFront field bucket), never the app's own. */
export function fieldKind(url: URL, ownOrigin: string): FieldKind | null {
  if (url.origin === ownOrigin) return null;
  const p = url.pathname;
  if (/^\/tiles\/[\w-]+\/[\w-]+\.pmtiles$/.test(p)) return 'geometry';
  if (/^\/v\/[\w-]+\/manifest\.json$/.test(p)) return 'manifest';
  if (/^\/v\/[\w-]+\/\d{10}\/\d+\.bin$/.test(p)) return 'cells';
  if (/^\/harga\/[\w-]+\/[\w-]+\.bin$/.test(p)) return 'harga';
  return null;
}

/** "bytes=a-b" (one closed range, as the PMTiles reader sends) to [a, b]; anything else is not cached. */
export function parseRange(h: string | null): [number, number] | null {
  const m = /^bytes=(\d+)-(\d+)$/.exec((h ?? '').trim());
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return b >= a ? [a, b] : null;
}

/** Cache key of one range of a file: the URL without its query, plus the range. */
export function rangeKey(url: string, range: [number, number]): string {
  return `${url.split('?')[0]}?__bytes=${range[0]}-${range[1]}`;
}

type CacheLike = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;

/** Most ranges kept per cache; both regions' archives together are about 4 MB, so this is only a safety cap. */
export const MAX_RANGES = 2000;

/**
 * A PMTiles range: from the cache when this range was read before (the archive path carries the geometry version and
 * is immutable), else from the network, keeping a copy when the server answered 206 with exactly the bytes asked.
 */
export async function cachedRange(request: Request, cache: CacheLike, fetchImpl: (r: Request) => Promise<Response>, maxEntries = MAX_RANGES): Promise<Response> {
  const range = parseRange(request.headers.get('range'));
  if (!range) return fetchImpl(request);
  const key = rangeKey(request.url, range);
  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.arrayBuffer();
    return new Response(body, {
      status: 206, statusText: 'Partial Content',
      headers: { 'Content-Type': hit.headers.get('Content-Type') ?? 'application/octet-stream', 'Content-Length': String(body.byteLength), 'Content-Range': `bytes ${range[0]}-${range[1]}/*` },
    });
  }
  const res = await fetchImpl(request);
  if (res.status === 206) {
    const body = await res.clone().arrayBuffer();
    if (body.byteLength === range[1] - range[0] + 1) {
      await cache.put(key, new Response(body, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - maxEntries))) await cache.delete(k);
    }
  }
  return res;
}
