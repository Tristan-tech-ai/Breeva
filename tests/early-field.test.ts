import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseStartRegion, defaultFetch, earlyHeaderSource, fetchManifest, FIELD_REGIONS, takeEarly } from '../src/lib/field/source';
// @ts-expect-error plain ES module used by the build (prerender-routes.mjs)
import { atHeadStart, earlyFieldScript, parseRegions } from '../early-field.mjs';
import { graphUrls } from '../src/lib/route/regionFiles';
import { parseRouteLink } from '../src/lib/route/share';

// F1-54: peta.html starts the region manifest and the PMTiles header with the HTML; the app takes them once.
const BASE = 'https://cdn.example.net';
const regions = parseRegions(readFileSync('src/lib/field/source.ts', 'utf8')) as Array<{ name: string; geometry: string; bounds: number[][] }>;

/** Runs the inline script in a fake page; returns the URLs it fetched and the __fieldEarly it left. */
function runScript(search: string, o: { mode?: 'peta' | 'app'; path?: string; stored?: string | null; tz?: string } = {}) {
  const calls: Array<{ url: string; init?: { cache?: string; headers?: Record<string, string> } }> = [];
  const win: Record<string, unknown> = {};
  const fetch = (url: string, init?: { cache?: string; headers?: Record<string, string> }) => {
    calls.push({ url, init });
    return Promise.resolve(url.endsWith('manifest.json')
      ? { ok: true, status: 200, json: () => Promise.resolve({ run: 'r', cells: [3, 7] }), headers: { get: () => null } }
      : { ok: true, status: 206, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)), headers: { get: (h: string) => (h === 'ETag' ? 'W/"weak"' : null) } });
  };
  const code = (earlyFieldScript(BASE, regions, o.mode ?? 'peta') as string).replace(/^<script>|<\/script>$/g, '');
  const localStorage = { getItem: (k: string) => (k === 'breeva_field_region' ? o.stored ?? null : null) };
  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: o.tz ?? 'Asia/Makassar' }) }) };
  runInNewContext(code, { URLSearchParams, location: { search, pathname: o.path ?? '/peta' }, fetch, window: win, Error, localStorage, Intl });
  return { calls, early: win.__fieldEarly as { name: string; manifest: Promise<unknown>; header: Promise<{ etag?: string }> } | undefined };
}

describe('the inline script of peta.html', () => {
  it('lists the same regions as FIELD_REGIONS', () => {
    expect(regions).toEqual(FIELD_REGIONS.map(({ name, geometry, bounds }) => ({ name, geometry, bounds })));
  });
  it('is left out of a build without a CDN field base', () => {
    expect(earlyFieldScript('', regions)).toBe('');
    expect(earlyFieldScript('/field', regions)).toBe('');
  });
  it('opens the first region by default, ?wilayah as the page does, and asks for the manifest and the header', async () => {
    const a = runScript('');
    expect(a.calls.map((c) => c.url)).toEqual([`${BASE}/v/badung_denpasar/manifest.json`, `${BASE}/tiles/2026-11/badung_denpasar.pmtiles`]);
    expect(a.calls[0].init?.cache).toBe('no-cache');
    expect(a.calls[1].init?.headers).toEqual({ range: 'bytes=0-16383' });
    expect((await a.early!.header).etag).toBeUndefined(); // a weak ETag is dropped, as pmtiles FetchSource does
    const b = runScript('?wilayah=kota_bogor');
    expect(b.early?.name).toBe('kota_bogor');
    expect(b.calls[1].url).toBe(`${BASE}/tiles/2026-11/kota_bogor.pmtiles`);
  });
  it('does nothing for school links', () => {
    expect(runScript('?sekolah=-6.6,106.8,SMA').calls).toEqual([]);
  });
  it('starts the core graph of a route link (and the shapes for motor), for the region WalkRouteLayer would route in (F1-57, F1-60)', async () => {
    // WalkRouteLayer: the first region whose bounds hold the start, and only when they also hold the end
    const inside = (r: (typeof FIELD_REGIONS)[number], p: { lat: number; lng: number }) =>
      r.bounds[0][0] <= p.lat && p.lat <= r.bounds[1][0] && r.bounds[0][1] <= p.lng && p.lng <= r.bounds[1][1];
    const links = [
      '?rute=-8.66978,115.21564~-8.67768,115.23378', '?rute=-8.66330,115.23670~-8.64614,115.21886&moda=motor&berangkat=07:00',
      '?rute=-6.56830,106.77044~-6.54559,106.78964&moda=motor&berangkat=06:45', '?rute=-8.82,115.08~-8.56,115.3',
      '?rute=-8.66978,115.21564~-6.54559,106.78964', '?rute=-7.25,112.75~-7.26,112.76', '?rute=-8.67,115.21',
      '?rute=a,b~c,d', '?rute=,~,', '?rute=-8.67,115.21~-8.66,115.22~-8.65,115.23',
    ];
    for (const search of links) {
      const link = parseRouteLink(search);
      const region = link && FIELD_REGIONS.find((r) => inside(r, link.from));
      // the same URLs the route worker asks for (regionFiles.ts), so its requests are served from these downloads:
      // the core graph, and for a motor route the edge shapes it waits for (F1-60)
      const want: string[] = [];
      if (region && inside(region, link!.to)) {
        const u = graphUrls(BASE, region);
        want.push(u.core);
        if (link!.mode === 'motor') want.push(u.shapes);
      }
      const run = runScript(search);
      expect(run.calls.map((c) => c.url).sort(), search).toEqual(want.sort());
      expect(run.calls.every((c) => c.init === undefined), search).toBe(true); // plain requests, like the worker's
    }
    expect(runScript(links[0]).calls[0].url).toBe(`${BASE}/graphs/2026-11/badung_denpasar_inti.bin`);
    expect(runScript(links[2]).calls[0].url).toBe(`${BASE}/graphs/2026-11/kota_bogor_inti.bin`);
    expect(runScript(links[0]).early).toBeUndefined(); // no map field requests: the map field waits for the route (F1-53)
    expect(runScript(links[0]).calls.length).toBe(1); // the core graph only (F1-59: the other files gave nothing)
    expect(runScript(links[1]).calls.length).toBe(2); // a motor link also asks for the edge shapes
  });
});

describe('the inline script of index.html (X-W7)', () => {
  it('on /home picks the region exactly as chooseStartRegion', () => {
    const cases: Array<{ search: string; stored: string | null; tz: string }> = [
      { search: '', stored: null, tz: 'Asia/Makassar' }, { search: '', stored: null, tz: 'Asia/Jakarta' },
      { search: '', stored: null, tz: 'Asia/Pontianak' }, { search: '', stored: 'kota_bogor', tz: 'Asia/Makassar' },
      { search: '', stored: 'badung_denpasar', tz: 'Asia/Jakarta' }, { search: '?wilayah=kota_bogor', stored: 'badung_denpasar', tz: 'Asia/Makassar' },
      { search: '?wilayah=jakarta', stored: 'surabaya', tz: 'UTC' },
    ];
    for (const c of cases) {
      const got = runScript(c.search, { mode: 'app', path: '/home', stored: c.stored, tz: c.tz }).early?.name;
      const want = chooseStartRegion({ param: new URLSearchParams(c.search).get('wilayah'), stored: c.stored, timeZone: c.tz }).name;
      expect(got, JSON.stringify(c)).toBe(want);
    }
  });
  it('on / opens as /peta, and other pages ask for nothing', () => {
    expect(runScript('', { mode: 'app', path: '/', stored: 'kota_bogor', tz: 'Asia/Jakarta' }).early?.name).toBe('badung_denpasar');
    expect(runScript('?wilayah=kota_bogor', { mode: 'app', path: '/' }).early?.name).toBe('kota_bogor');
    for (const path of ['/prioritas', '/status', '/uji-coba', '/profile']) expect(runScript('', { mode: 'app', path }).calls).toEqual([]);
    expect(runScript('?rute=-8.6,115.2~-8.7,115.3', { mode: 'app', path: '/home' }).calls).toEqual([]);
  });
});

describe('the app takes the early requests once', () => {
  afterEach(() => { delete (globalThis as { __fieldEarly?: unknown }).__fieldEarly; });

  it('fetchManifest uses the early manifest instead of a second request, and only for the browser fetch', async () => {
    // no second request: the real fetch of a relative URL would throw in Node and fail the test
    (globalThis as { __fieldEarly?: unknown }).__fieldEarly = { base: '/e1', name: 'r', manifest: Promise.resolve({ run: 'early' }) };
    expect(takeEarly('manifest', '/other', 'r')).toBeUndefined(); // another base is not this request
    expect((await fetchManifest('/e1', 'r', defaultFetch, 0)).run).toBe('early');
    expect(takeEarly('manifest', '/e1', 'r')).toBeUndefined(); // taken once
  });
  it('a failed early manifest falls back to the app request', async () => {
    (globalThis as { __fieldEarly?: unknown }).__fieldEarly = { base: '/e2', name: 'r', manifest: Promise.reject(new Error('offline')) };
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ run: 'own' }))) as typeof fetch;
    try { expect((await fetchManifest('/e2', 'r', defaultFetch, 0)).run).toBe('own'); } finally { globalThis.fetch = real; }
  });
  it('the PMTiles source serves the header bytes from the early request once', async () => {
    const header = { data: new ArrayBuffer(16384), etag: '"abc"' };
    (globalThis as { __fieldEarly?: unknown }).__fieldEarly = { base: '/e3', name: 'r', header: Promise.resolve(header) };
    const src = earlyHeaderSource('/e3/tiles/2026-11/r.pmtiles', '/e3', 'r');
    expect(src.getKey()).toBe('/e3/tiles/2026-11/r.pmtiles');
    expect(await src.getBytes(0, 16384)).toBe(header);
    expect(takeEarly('header', '/e3', 'r')).toBeUndefined();
  });
});

describe('atHeadStart (F1-56): the early scripts run before any stylesheet', () => {
  const tpl = '<!doctype html><html lang="id"><head>\n<meta charset="UTF-8" />\n<link rel="stylesheet" href="/assets/index.css"><title>x</title></head><body></body></html>';
  it('puts the snippet right after the charset meta and before the stylesheet', () => {
    const out = atHeadStart(tpl, '<script>1</script>') as string;
    expect(out.indexOf('<script>1</script>')).toBeGreaterThan(out.indexOf('<meta charset'));
    expect(out.indexOf('<script>1</script>')).toBeLessThan(out.indexOf('rel="stylesheet"'));
  });
  it('fails a build whose template has no charset meta', () => {
    expect(() => atHeadStart('<head><link rel="stylesheet" href="a.css"></head>', 'x')).toThrow('meta charset');
  });
});
