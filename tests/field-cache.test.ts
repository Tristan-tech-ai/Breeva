import { describe, expect, it } from 'vitest';
import { cachedRange, fieldKind, parseRange, rangeKey } from '../src/lib/pwa/fieldCache';

const CF = 'https://d26tdym6xlfc4n.cloudfront.net';
const OWN = 'https://breeva.site';

function fakeCache() {
  const m = new Map<string, Response>();
  const key = (k: RequestInfo | URL) => (typeof k === 'string' ? k : k instanceof URL ? k.href : k.url);
  return {
    m,
    match: async (k: RequestInfo | URL) => m.get(key(k))?.clone(),
    put: async (k: RequestInfo | URL, r: Response) => { if (r.status === 206) throw new TypeError('Partial response (status code 206) is unsupported'); m.set(key(k), r); },
    keys: async () => [...m.keys()].map((u) => new Request(u)),
    delete: async (k: RequestInfo | URL) => m.delete(key(k)),
  } as unknown as Cache & { m: Map<string, Response> };
}
const file = new Uint8Array(4096).map((_, k) => k % 251);
const net = (calls: string[], online = true) => async (r: Request) => {
  calls.push(r.headers.get('range') ?? 'full');
  if (!online) throw new TypeError('Failed to fetch');
  const [a, b] = parseRange(r.headers.get('range'))!;
  return new Response(file.slice(a, b + 1), { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${a}-${b}/4096` } });
};

describe('offline field files (F2-12)', () => {
  it('names the CloudFront field files and nothing of the app itself', () => {
    expect(fieldKind(new URL(`${CF}/tiles/2026-11/kota_bogor.pmtiles`), OWN)).toBe('geometry');
    expect(fieldKind(new URL(`${CF}/v/kota_bogor/manifest.json`), OWN)).toBe('manifest');
    expect(fieldKind(new URL(`${CF}/v/kota_bogor/2026111714/3.bin`), OWN)).toBe('cells');
    expect(fieldKind(new URL(`${CF}/harga/2026-11/badung_denpasar.bin`), OWN)).toBe('harga');
    expect(fieldKind(new URL(`${CF}/v/kota_bogor/validation_recent.json`), OWN)).toBeNull();
    expect(fieldKind(new URL(`${OWN}/tiles/2026-11/kota_bogor.pmtiles`), OWN)).toBeNull();
    expect(fieldKind(new URL('https://tile.openstreetmap.org/15/1/2.png'), OWN)).toBeNull();
  });

  it('parses only one closed byte range', () => {
    expect(parseRange('bytes=0-16383')).toEqual([0, 16383]);
    expect(parseRange('bytes=100-')).toBeNull();
    expect(parseRange('bytes=0-1,5-9')).toBeNull();
    expect(parseRange(null)).toBeNull();
    expect(rangeKey(`${CF}/tiles/x/y.pmtiles?v=2`, [0, 9])).toBe(`${CF}/tiles/x/y.pmtiles?__bytes=0-9`);
  });

  it('a range read online is served offline as a 206 with exactly the same bytes', async () => {
    const cache = fakeCache(), calls: string[] = [];
    const req = () => new Request(`${CF}/tiles/2026-11/kota_bogor.pmtiles`, { headers: { range: 'bytes=100-299' } });
    const online = await cachedRange(req(), cache, net(calls));
    expect(online.status).toBe(206);
    expect(new Uint8Array(await online.arrayBuffer())).toEqual(file.slice(100, 300));
    const offline = await cachedRange(req(), cache, net(calls, false));
    expect(calls).toEqual(['bytes=100-299']); // the second read never touched the network
    expect(offline.status).toBe(206);
    expect(offline.headers.get('Content-Length')).toBe('200');
    expect(new Uint8Array(await offline.arrayBuffer())).toEqual(file.slice(100, 300));
  });

  it('a range never seen fails offline (no made-up bytes), and odd answers are not kept', async () => {
    const cache = fakeCache();
    await expect(cachedRange(new Request(`${CF}/tiles/a/b.pmtiles`, { headers: { range: 'bytes=0-9' } }), cache, net([], false))).rejects.toThrow();
    const full = async () => new Response(file, { status: 200 });
    const r = await cachedRange(new Request(`${CF}/tiles/a/b.pmtiles`, { headers: { range: 'bytes=0-9' } }), cache, full);
    expect(r.status).toBe(200);
    const short = async () => new Response(file.slice(0, 5), { status: 206 });
    await cachedRange(new Request(`${CF}/tiles/a/b.pmtiles`, { headers: { range: 'bytes=0-9' } }), cache, short);
    expect(cache.m.size).toBe(0);
  });

  it('keeps at most maxEntries ranges, dropping the oldest', async () => {
    const cache = fakeCache();
    for (let k = 0; k < 5; k++) await cachedRange(new Request(`${CF}/tiles/a/b.pmtiles`, { headers: { range: `bytes=${k * 10}-${k * 10 + 9}` } }), cache, net([]), 3);
    expect([...cache.m.keys()].map((u) => u.split('__bytes=')[1])).toEqual(['20-29', '30-39', '40-49']);
  });
});
