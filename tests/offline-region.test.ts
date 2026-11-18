import { describe, expect, it } from 'vitest';
import { cachedRange, FIELD_CACHES, fullKey } from '../src/lib/pwa/fieldCache';
import { regionFiles, saveRegionOffline, sizeLabel } from '../src/lib/pwa/offlineRegion';
import { ROUTE_CACHE } from '../src/lib/route/assets';

const BASE = 'https://d26tdym6xlfc4n.cloudfront.net';
const R = { name: 'kota_bogor', geometry: '2026-11' };
const M = { run: '2026111716', cells: [0, 1], forecast_runs: [{ key: 'x2026111717.bin' }] };

function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const key = (k: RequestInfo | URL) => (typeof k === 'string' ? k : k instanceof URL ? k.href : k.url);
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      put: async (k: RequestInfo | URL, r: Response) => { m.set(key(k), r); },
      match: async (k: RequestInfo | URL) => m.get(key(k))?.clone(),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (k: RequestInfo | URL) => m.delete(key(k)),
    };
  };
  return { store, open };
}

describe('saving a region for offline (F2-15)', () => {
  it('lists the files the map and the router read, each into the caches that read it', () => {
    const files = regionFiles(BASE, R, M);
    const urls = files.map((f) => f.url.replace(BASE, ''));
    expect(urls).toEqual([
      '/tiles/2026-11/kota_bogor.pmtiles', '/v/kota_bogor/manifest.json', '/v/kota_bogor/2026111716/0.bin', '/v/kota_bogor/2026111716/1.bin',
      '/v/kota_bogor/2026111716/x2026111717.bin', '/harga/2026-11/kota_bogor.bin', '/graphs/2026-11/kota_bogor_inti2.bin', '/graphs/2026-11/kota_bogor_bentuk.bin', '/graphs/2026-11/kota_bogor_schools.json',
    ]);
    expect(files[0]).toMatchObject({ into: [FIELD_CACHES.geometry], whole: true });
    expect(files[2].into).toEqual([FIELD_CACHES.cells, ROUTE_CACHE]);
    expect(files.some((f) => /openstreetmap|cartocdn/.test(f.url))).toBe(false); // no basemap
  });

  it('downloads each file once, stores it, and reports the real size', async () => {
    const fc = fakeCaches();
    const seen: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => {
      const url = String(u);
      seen.push(url);
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(M), { headers: { 'Content-Type': 'application/json' } });
      return new Response(new Uint8Array(url.endsWith('.pmtiles') ? 1000 : 10));
    }) as typeof fetch;
    const progress: number[] = [];
    const r = await saveRegionOffline(BASE, R, { fetchImpl, cachesImpl: fc, onProgress: (d) => progress.push(d) });
    expect(r).toMatchObject({ files: 9, run: '2026111716' });
    expect(r.bytes).toBe(1000 + JSON.stringify(M).length + 7 * 10); // F1-56: graph core and shapes are two files
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(seen.filter((u) => u.endsWith('.pmtiles'))).toHaveLength(1);
    expect(fc.store.get(FIELD_CACHES.geometry)!.has(fullKey(`${BASE}/tiles/2026-11/kota_bogor.pmtiles`))).toBe(true);
    expect(fc.store.get(ROUTE_CACHE)!.size).toBe(8);
    expect(sizeLabel(4_123_456)).toBe('4,1 MB');
  });

  it('fails loudly when a file is missing', async () => {
    const fetchImpl = (async (u: RequestInfo | URL) => (String(u).endsWith('manifest.json') ? new Response(JSON.stringify(M)) : new Response('', { status: 404 }))) as typeof fetch;
    await expect(saveRegionOffline(BASE, R, { fetchImpl, cachesImpl: fakeCaches() })).rejects.toThrow(/HTTP 404/);
  });

  it('a range never read is cut from the saved whole archive, offline, with the same bytes', async () => {
    const fc = fakeCaches();
    const url = `${BASE}/tiles/2026-11/test_utuh.pmtiles`;
    const file = new Uint8Array(5000).map((_, k) => (k * 7) % 256);
    const cache = await fc.open(FIELD_CACHES.geometry);
    await cache.put(fullKey(url), new Response(file));
    const offline = async () => { throw new TypeError('Failed to fetch'); };
    const r = await cachedRange(new Request(url, { headers: { range: 'bytes=1200-1299' } }), cache as unknown as Cache, offline);
    expect(r.status).toBe(206);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(file.slice(1200, 1300));
    // beyond the end of the file: not invented
    await expect(cachedRange(new Request(url, { headers: { range: 'bytes=4990-6000' } }), cache as unknown as Cache, offline)).rejects.toThrow();
  });

  it('pruning ranges never removes a whole archive saved on purpose', async () => {
    const fc = fakeCaches();
    const url = `${BASE}/tiles/2026-11/prune.pmtiles`;
    const cache = await fc.open('prune');
    await cache.put(fullKey(url), new Response(new Uint8Array(10)));
    const net = async (q: Request) => {
      const [a, b] = q.headers.get('range')!.slice(6).split('-').map(Number);
      return new Response(new Uint8Array(b - a + 1), { status: 206 });
    };
    for (let k = 0; k < 4; k++) await cachedRange(new Request(`${BASE}/tiles/2026-11/other.pmtiles`, { headers: { range: `bytes=${k * 10}-${k * 10 + 9}` } }), cache as unknown as Cache, net, 2);
    const keys = (await cache.keys()).map((r) => r.url);
    expect(keys).toContain(fullKey(url));
    expect(keys.filter((u) => u.includes('__bytes='))).toHaveLength(2);
  });
});

describe('what is saved, read back from the caches (F2-16)', async () => {
  const { readSaved, markerKey } = await import('../src/lib/pwa/offlineRegion');
  const okFetch = (async (u: RequestInfo | URL) => (String(u).endsWith('manifest.json') ? new Response(JSON.stringify(M)) : new Response(new Uint8Array(10)))) as typeof fetch;
  it('a complete save is found with its run and size', async () => {
    const fc = fakeCaches();
    expect(await readSaved(BASE, R, fc)).toBeNull();
    const r = await saveRegionOffline(BASE, R, { fetchImpl: okFetch, cachesImpl: fc });
    const info = await readSaved(BASE, R, fc);
    expect(info).toMatchObject({ run: '2026111716', bytes: r.bytes, files: 9 });
    expect(Number.isFinite(Date.parse(info!.at))).toBe(true);
  });
  it('a save cut short (no record) or an archive gone (record left) is not reported as saved', async () => {
    const cut = fakeCaches();
    const failing = (async (u: RequestInfo | URL) => (String(u).endsWith('manifest.json') ? new Response(JSON.stringify(M)) : String(u).includes('graphs') ? new Response('', { status: 503 }) : new Response(new Uint8Array(10)))) as typeof fetch;
    await expect(saveRegionOffline(BASE, R, { fetchImpl: failing, cachesImpl: cut })).rejects.toThrow();
    expect(await readSaved(BASE, R, cut)).toBeNull();
    const gone = fakeCaches();
    await saveRegionOffline(BASE, R, { fetchImpl: okFetch, cachesImpl: gone });
    gone.store.get(FIELD_CACHES.geometry)!.delete(fullKey(`${BASE}/tiles/2026-11/kota_bogor.pmtiles`));
    expect(gone.store.get(FIELD_CACHES.geometry)!.has(markerKey(BASE, 'kota_bogor'))).toBe(true);
    expect(await readSaved(BASE, R, gone)).toBeNull();
  });
});
