import { describe, expect, it } from 'vitest';
import { CachedRangeSource } from '../src/lib/cachedRangeSource';
import type { CacheLike } from '../src/lib/pwa/fieldCache';

// X-W40: basemap ranges fetched before the service worker controls the page are kept in Cache Storage anyway, so a
// second visit does not download them again.
function memCache(): CacheLike & { size(): number } {
  const m = new Map<string, Response>();
  const key = (k: RequestInfo | URL) => (typeof k === 'string' ? k : k instanceof URL ? k.href : k.url);
  return {
    put: async (k, r) => { m.set(key(k), r); },
    match: async (k) => m.get(key(k as RequestInfo))?.clone(),
    keys: async () => [...m.keys()].map((u) => new Request(u)),
    delete: async (k) => m.delete(key(k as RequestInfo)),
    size: () => m.size,
  } as CacheLike & { size(): number };
}

const URL_ = 'https://cdn.test/tiles/basemap/2026-11-17/kota_bogor.pmtiles';
const net = () => {
  const calls: string[] = [];
  const f = async (r: Request) => {
    calls.push(r.headers.get('range') ?? '');
    const [a, b] = (r.headers.get('range') ?? '').replace('bytes=', '').split('-').map(Number);
    return new Response(new Uint8Array(b - a + 1).fill(7), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/9999` } });
  };
  return { calls, f };
};

describe('CachedRangeSource', () => {
  it('fetches a range once and serves it from Cache Storage the next time', async () => {
    const cache = memCache();
    const n = net();
    const s = new CachedRangeSource(URL_, async () => cache, n.f);
    const a = await s.getBytes(100, 50);
    const b = await s.getBytes(100, 50);
    expect(a.data.byteLength).toBe(50);
    expect(b.data.byteLength).toBe(50);
    expect(n.calls).toEqual(['bytes=100-149']);
    expect(cache.size()).toBe(1);
    expect(s.getKey()).toBe(URL_);
  });

  it('still works without Cache Storage (private mode)', async () => {
    const n = net();
    const s = new CachedRangeSource(URL_, async () => null, n.f);
    expect((await s.getBytes(0, 10)).data.byteLength).toBe(10);
    expect((await s.getBytes(0, 10)).data.byteLength).toBe(10);
    expect(n.calls).toHaveLength(2);
  });

  it('fails loudly on an error response', async () => {
    const s = new CachedRangeSource(URL_, async () => null, async () => new Response('x', { status: 403 }));
    await expect(s.getBytes(0, 10)).rejects.toThrow('403');
  });
});
