/**
 * A PMTiles source that keeps every byte range in Cache Storage from the page itself (X-W40). On a first visit the
 * service worker does not control the page yet, so the basemap ranges fetched then never reached its range cache and
 * the second visit downloaded them again (140 KB, kuota_xw40_diag_2026-11-19.json). Reading through the same cachedRange
 * as the service worker stores them at once; a region saved whole for offline is also cut from here.
 */
import { cachedRange, FIELD_CACHES, type CacheLike } from './pwa/fieldCache';

export interface RangeResponse { data: ArrayBuffer; etag?: string }

export class CachedRangeSource {
  private readonly url: string;
  private readonly openCache: () => Promise<CacheLike | null>;
  private readonly fetchImpl: (r: Request) => Promise<Response>;

  constructor(url: string, openCache: () => Promise<CacheLike | null> = defaultCache, fetchImpl: (r: Request) => Promise<Response> = (r) => fetch(r)) {
    this.url = url;
    this.openCache = openCache;
    this.fetchImpl = fetchImpl;
  }

  getKey(): string {
    return this.url;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    const req = new Request(this.url, { headers: { range: `bytes=${offset}-${offset + length - 1}` }, signal });
    const cache = await this.openCache().catch(() => null);
    const res = cache ? await cachedRange(req, cache, this.fetchImpl) : await this.fetchImpl(req);
    if (res.status !== 206 && res.status !== 200) throw new Error(`peta dasar ${res.status}`);
    return { data: await res.arrayBuffer(), etag: res.headers.get('ETag') ?? undefined };
  }
}

async function defaultCache(): Promise<CacheLike | null> {
  return typeof caches === 'undefined' ? null : ((await caches.open(FIELD_CACHES.geometry)) as unknown as CacheLike);
}
