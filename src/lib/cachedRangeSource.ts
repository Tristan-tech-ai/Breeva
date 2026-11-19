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
  /** Ranges being fetched now: the same range asked twice at once is downloaded once (X-W51: header read ahead). */
  private readonly inflight = new Map<string, Promise<RangeResponse>>();

  constructor(url: string, openCache: () => Promise<CacheLike | null> = defaultCache, fetchImpl: (r: Request) => Promise<Response> = (r) => fetch(r)) {
    this.url = url;
    this.openCache = openCache;
    this.fetchImpl = fetchImpl;
  }

  getKey(): string {
    return this.url;
  }

  getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    // only reads that cannot be cancelled are shared (the header): a tile read carries its own AbortSignal, and sharing it
    // would let one cancelled tile fail another that still wants the same bytes
    if (signal) return this.fetchRange(offset, length, signal);
    const k = `${offset}-${length}`;
    const running = this.inflight.get(k);
    if (running) return running;
    const p = this.fetchRange(offset, length, signal).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  private async fetchRange(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
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

/** PMTiles reads this many bytes first: the header and the root directory (pmtiles getHeaderAndRoot). */
export const PMTILES_HEADER_BYTES = 16384;

const shared = new Map<string, CachedRangeSource>();

/** One source per URL for the page, so a header read ahead (readAheadHeader) is the one PMTiles reads. */
export function sharedRangeSource(url: string): CachedRangeSource {
  let s = shared.get(url);
  if (!s) { s = new CachedRangeSource(url); shared.set(url, s); }
  return s;
}

/**
 * X-W51: start the header download at once, alongside the import of the basemap modules, instead of after them; PMTiles
 * then finds it in flight or in Cache Storage. On slow 3G this saves one round trip before the basemap tiles are asked for.
 */
export function readAheadHeader(src: Pick<CachedRangeSource, 'getBytes'>): void {
  void src.getBytes(0, PMTILES_HEADER_BYTES).catch(() => { /* PMTiles asks again and reports the error itself */ });
}
