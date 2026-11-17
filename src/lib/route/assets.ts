/**
 * Files the router needs (walking graph, field manifest and cells), kept in the Cache API so routing works offline.
 * Network first for the manifest (it changes every hour), cache first for everything else (immutable or daily files).
 */
export const ROUTE_CACHE = 'breeva-route-v1';

type CacheLike = Pick<Cache, 'match' | 'put'>;

async function openCache(): Promise<CacheLike | null> {
  try { return typeof caches !== 'undefined' ? await caches.open(ROUTE_CACHE) : null; } catch { return null; }
}

/** Response body of url: from the cache when present (cacheFirst) or when the network fails; stored after a fetch. */
export async function cachedBytes(url: string, opts: { cacheFirst: boolean; fetchImpl?: typeof fetch; cache?: CacheLike | null; onBytes?: (n: number) => void } = { cacheFirst: true }): Promise<Uint8Array> {
  const f = opts.fetchImpl ?? fetch;
  const cache = opts.cache === undefined ? await openCache() : opts.cache;
  if (opts.cacheFirst && cache) {
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  try {
    const r = await f(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const buf = opts.onBytes && r.body ? await readCounting(r.body, opts.onBytes) : new Uint8Array(await r.arrayBuffer());
    if (cache) await cache.put(url, new Response(buf.slice()));
    return buf;
  } catch (e) {
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    throw e;
  }
}

/** The whole body, reporting each chunk's size as it arrives (X-W4: download progress on a slow link). */
export async function readCounting(body: ReadableStream<Uint8Array>, onBytes: (n: number) => void): Promise<Uint8Array> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    onBytes(value.byteLength);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
