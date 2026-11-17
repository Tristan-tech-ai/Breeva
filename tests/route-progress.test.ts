import { describe, expect, it, vi } from 'vitest';
import { COMPUTING, progressCounter, routeLoadingText, SHOW_PROGRESS_AFTER_MS, sizeText } from '../src/lib/route/loadProgress';
import { announceRoutes } from '../src/lib/route/summary';
import { cachedBytes, readCounting } from '../src/lib/route/assets';

// X-W4: on a slow link the first route waits about 50 s for the walking graph; the card says what is downloading.
describe('routeLoadingText', () => {
  it('keeps the plain text for short waits, so a fast connection never sees the download message', () => {
    expect(routeLoadingText(900_000, SHOW_PROGRESS_AFTER_MS - 1)).toBe(COMPUTING);
    expect(SHOW_PROGRESS_AFTER_MS).toBe(3000);
  });
  it('after 3 s says what downloads, its size on the wire (what a data plan pays) and how long it has taken', () => {
    const t = routeLoadingText(1_201_000, 12_400);
    expect(t).toContain('Mengunduh peta jalan kaki wilayah ini, sekali saja (sekitar 1,2 MB)');
    expect(t).toContain('Sudah 12 detik');
    expect(t).toContain('sesudahnya tersimpan di ponsel');
    expect(routeLoadingText(0, 5000)).not.toContain('sekitar'); // no Content-Length: no size rather than a wrong one
  });
  it('writes sizes the Indonesian way', () => {
    expect(sizeText(350_400)).toBe('350 KB');
    expect(sizeText(1_073_347)).toBe('1,1 MB');
    expect(sizeText(12_500_000)).toBe('12,5 MB');
  });
});

describe('progressCounter', () => {
  it('sums the encoded sizes and posts at most every interval while bytes arrive', () => {
    let now = 0;
    const post = vi.fn();
    const m = progressCounter(post, 250, () => now);
    m.start(1_073_347); m.start(null); m.start(59_013);
    m.bytes(100); now = 100; m.bytes(100); now = 260; m.bytes(50); now = 600; m.bytes(0);
    expect(post.mock.calls.map((c) => c[0])).toEqual([1_132_360, 1_132_360]);
  });
});

describe('cachedBytes with a download meter', () => {
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
  const streamed = () => new Response(new ReadableStream<Uint8Array>({ start(c) { for (const k of chunks) c.enqueue(k); c.close(); } }));
  it('reads the whole body and reports each chunk', async () => {
    const seen: number[] = [];
    const out = await readCounting(streamed().body!, (n) => seen.push(n));
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen).toEqual([3, 2, 1]);
  });
  it('meters a network download (Content-Length on the wire, decoded chunks), not a cache hit', async () => {
    const starts: Array<number | null> = [], seen: number[] = [];
    const meter = { start: (n: number | null) => starts.push(n), bytes: (n: number) => seen.push(n) };
    const fetchImpl = (async () => { const r = streamed(); return new Response(r.body, { headers: { 'content-length': '4' } }); }) as unknown as typeof fetch;
    const out = await cachedBytes('/x.bin', { cacheFirst: true, fetchImpl, cache: null, meter });
    expect(out.byteLength).toBe(6);
    expect(starts).toEqual([4]);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(6);
    const hit = { match: async () => new Response(new Uint8Array([9])), put: async () => {} };
    const starts2: Array<number | null> = [];
    await cachedBytes('/x.bin', { cacheFirst: true, fetchImpl, cache: hit, meter: { start: (n) => starts2.push(n), bytes: () => {} } });
    expect(starts2).toEqual([]);
  });
});

describe('screen readers', () => {
  it('hear the download message once: the live region text does not change with the size or the seconds', () => {
    const a = announceRoutes([], routeLoadingText(1_100_000, 5_000));
    const b = announceRoutes([], routeLoadingText(1_201_000, 34_000));
    expect(a).toBe(b);
    expect(a).toContain('Mengunduh peta jalan kaki wilayah ini');
    expect(a).not.toMatch(/Sudah \d+ detik/);
    expect(announceRoutes([], COMPUTING)).toBe(COMPUTING);
  });
});
