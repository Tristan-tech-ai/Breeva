import { describe, expect, it, vi } from 'vitest';
import { COMPUTING, progressCounter, routeLoadingText, SHOW_PROGRESS_AFTER_MS, sizeText } from '../src/lib/route/loadProgress';
import { cachedBytes, readCounting } from '../src/lib/route/assets';

// X-W4: on a slow link the first route waits about 50 s for the walking graph; the card says what is downloading.
describe('routeLoadingText', () => {
  it('keeps the plain text for short waits, so a fast connection never sees the download message', () => {
    expect(routeLoadingText(900_000, SHOW_PROGRESS_AFTER_MS - 1)).toBe(COMPUTING);
    expect(SHOW_PROGRESS_AFTER_MS).toBe(3000);
  });
  it('after 3 s says what downloads and how much has arrived', () => {
    const t = routeLoadingText(1_234_567, 12_000);
    expect(t).toContain('Mengunduh peta jalan kaki wilayah ini: 1,2 MB diterima');
    expect(t).toContain('sesudahnya tersimpan di ponsel');
    expect(routeLoadingText(0, 5000)).toContain('0 KB diterima');
  });
  it('writes sizes the Indonesian way', () => {
    expect(sizeText(350_400)).toBe('350 KB');
    expect(sizeText(1_073_347)).toBe('1,1 MB');
    expect(sizeText(12_500_000)).toBe('12,5 MB');
  });
});

describe('progressCounter', () => {
  it('posts the running total at most every interval', () => {
    let now = 0;
    const post = vi.fn();
    const count = progressCounter(post, 250, () => now);
    count(100); now = 100; count(100); now = 260; count(50); now = 300; count(10); now = 600; count(0);
    expect(post.mock.calls.map((c) => c[0])).toEqual([100, 250, 260]);
  });
});

describe('cachedBytes with onBytes', () => {
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
  const streamed = () => new Response(new ReadableStream<Uint8Array>({ start(c) { for (const k of chunks) c.enqueue(k); c.close(); } }));
  it('reads the whole body and reports each chunk', async () => {
    const seen: number[] = [];
    const out = await readCounting(streamed().body!, (n) => seen.push(n));
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen).toEqual([3, 2, 1]);
  });
  it('counts a network download, not a cache hit', async () => {
    const seen: number[] = [];
    const fetchImpl = (async () => streamed()) as unknown as typeof fetch;
    const out = await cachedBytes('/x.bin', { cacheFirst: true, fetchImpl, cache: null, onBytes: (n) => seen.push(n) });
    expect(out.byteLength).toBe(6);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(6);
    const hit = { match: async () => new Response(new Uint8Array([9])), put: async () => {} };
    const seen2: number[] = [];
    await cachedBytes('/x.bin', { cacheFirst: true, fetchImpl, cache: hit, onBytes: (n) => seen2.push(n) });
    expect(seen2).toEqual([]);
  });
});
