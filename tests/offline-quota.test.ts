import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateDownload, estimateText, regionFiles, saveRegionOffline, savedText, wireSize } from '../src/lib/pwa/offlineRegion';

// X-W12: /status says what saving a region costs a data plan before it is pressed, and both sizes after.
const BASE = 'https://cdn.test';
const R = { name: 'kota_bogor', geometry: '2026-11' };
const M = { run: '2026111800', cells: [0, 1], forecast_runs: [{ key: 'x2026111801.bin' }] };

describe('wireSize', () => {
  it('takes the Content-Length (encoded size) and falls back to the decoded size', () => {
    expect(wireSize(new Response('x', { headers: { 'content-length': '400' } }), 1000)).toBe(400);
    expect(wireSize(new Response('x'), 1000)).toBe(1000);
  });
});

describe('estimateDownload', () => {
  it('sums the HEAD sizes of every file of the region, leaving out the files that do not tell', async () => {
    const methods: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      methods.push(init?.method ?? 'GET');
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(M));
      if (url.endsWith('_schools.json')) return new Response(null, { status: 200 }); // compressed on the fly: no length
      return new Response(null, { status: 200, headers: { 'content-length': url.endsWith('.pmtiles') ? '2000000' : '1000' } });
    }) as typeof fetch;
    const e = await estimateDownload(BASE, R, fetchImpl);
    const n = regionFiles(BASE, R, M).length;
    expect(e.files).toBe(n);
    expect(e.known).toBe(n - 2); // manifest and school points have no Content-Length here
    expect(e.sent).toBe(2 * 2_000_000 + 1000 * (n - 4)); // two PMTiles: road geometry and the basemap (F1-68)
    expect(methods.filter((x) => x === 'HEAD')).toHaveLength(n); // no file body is downloaded to estimate
  });
});

describe('saving records the size on the phone and the size downloaded', () => {
  it('sent comes from Content-Length when present', async () => {
    const store = new Map<string, Map<string, Response>>();
    const cachesImpl = { open: async (k: string) => { if (!store.has(k)) store.set(k, new Map()); const c = store.get(k)!; return { put: async (key: RequestInfo | URL, r: Response) => { c.set(String(key), r); }, match: async (key: RequestInfo | URL) => c.get(String(key)) }; } };
    const fetchImpl = (async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify(M));
      return new Response(new Uint8Array(30), { headers: { 'content-length': url.includes('/graphs/') ? '10' : '30' } });
    }) as typeof fetch;
    const r = await saveRegionOffline(BASE, R, { fetchImpl, cachesImpl: cachesImpl as never });
    const n = regionFiles(BASE, R, M).length;
    expect(r.bytes).toBe(JSON.stringify(M).length + 30 * (n - 1));
    expect(r.sent).toBe(JSON.stringify(M).length + 30 * (n - 4) + 10 * 3); // graph core, shapes, schools: 10 on the wire
    expect(r.sent!).toBeLessThan(r.bytes);
  });
});

describe('texts', () => {
  it('says both sizes after saving, and only the stored size for an older record', () => {
    expect(savedText({ files: 20, bytes: 6_900_000, sent: 2_400_000, run: '2026111800' }, '18 Nov 2026 06.47')).toBe(
      'Tersimpan untuk tanpa internet: 6,9 MB di ponsel, terunduh 2,4 MB (20 berkas, run 2026111800, disimpan 18 Nov 2026 06.47).');
    expect(savedText({ files: 20, bytes: 6_900_000, run: 'r' }, 'kemarin')).not.toContain('terunduh');
  });
  it('gives an estimate only when something was measured', () => {
    expect(estimateText({ sent: 2_400_000, known: 18 })).toContain('Perkiraan unduhan sekitar 2,4 MB');
    expect(estimateText({ sent: 0, known: 0 })).toBe('');
    expect(estimateText(null)).toBe('');
  });
});

describe('the /status intro (X-W23)', () => {
  it('names no fixed download size: the sizes change with the files (18 Nov: 3,5 and 7 MB were stale after F1-61)', () => {
    const src = readFileSync('src/pages/StatusPage.tsx', 'utf8');
    expect(src).not.toMatch(/[0-9],?[0-9]* MB untuk (Kota Bogor|Badung)/);
    expect(src).toContain('perkiraan unduhannya tertulis di bawah tiap tombol');
  });
});
