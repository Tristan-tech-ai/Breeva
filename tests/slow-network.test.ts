import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_FAILED_EVENT, FIRST_DRAW_FALLBACK_MS, onFirstDraw, ROUTE_FALLBACK_MS, ROUTE_SETTLED_EVENT, routeSettled } from '../src/lib/field/firstDraw';
import { fetchManifest, FIELD_DRAWN_EVENT, MANIFEST_TTL_MS } from '../src/lib/field/source';
// @ts-expect-error plain ES module used by the build (prerender-routes.mjs)
import { appPreloadScript, preloadFiles, preloadTags, referencedAssets } from '../preload-links.mjs';

// F1-51: on the DevTools "3G" profile (2 s per request, 50 KB/s) the coloured map took 32.9 s. Three causes, three fixes.

describe('onFirstDraw: the base map waits for the roads, not for a short timer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not give up after the old 5-6 s', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t);
    vi.advanceTimersByTime(6_000);
    expect(cb).not.toHaveBeenCalled();
    expect(FIRST_DRAW_FALLBACK_MS).toBeGreaterThan(33_000); // longer than the measured 3G first draw
  });
  it('fires once on the first coloured roads', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t);
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    vi.advanceTimersByTime(FIRST_DRAW_FALLBACK_MS * 2);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('fires at once when the field fails', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t);
    t.dispatchEvent(new Event(FIELD_FAILED_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('fires after the fallback when nothing is heard', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t, 1_000);
    vi.advanceTimersByTime(999); expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(cb).toHaveBeenCalledTimes(1);
  });
  it('never fires after cleanup', () => {
    const t = new EventTarget(); const cb = vi.fn();
    const stop = onFirstDraw(cb, t, 1_000);
    stop();
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    vi.advanceTimersByTime(5_000);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('route links: the base map and the other regions wait for the first route too (F1-53)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('needs both the first roads and the first route', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t, undefined, true);
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    vi.advanceTimersByTime(FIRST_DRAW_FALLBACK_MS + 1);
    expect(cb).not.toHaveBeenCalled(); // the 40 s fallback of a plain map does not apply
    t.dispatchEvent(new Event(ROUTE_SETTLED_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('a route alone is not enough, and a field failure counts as drawn', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t, undefined, true);
    t.dispatchEvent(new Event(ROUTE_SETTLED_EVENT));
    expect(cb).not.toHaveBeenCalled();
    t.dispatchEvent(new Event(FIELD_FAILED_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('gives up after the route fallback, longer than the measured 3G route', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t, undefined, true);
    vi.advanceTimersByTime(ROUTE_FALLBACK_MS - 1); expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(cb).toHaveBeenCalledTimes(1);
    expect(ROUTE_FALLBACK_MS).toBeGreaterThan(55_000); // lambat3g_worker_2026-11-18.json: card after 54.5 s
  });
  it('without a route link the route event is not awaited', () => {
    const t = new EventTarget(); const cb = vi.fn();
    onFirstDraw(cb, t);
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('routeSettled resolves on the event or after its fallback', async () => {
    const t = new EventTarget();
    let a = false, b = false;
    void routeSettled(t, 1_000).then(() => { a = true; });
    t.dispatchEvent(new Event(ROUTE_SETTLED_EVENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toBe(true);
    void routeSettled(t, 1_000).then(() => { b = true; });
    await vi.advanceTimersByTimeAsync(999); expect(b).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(b).toBe(true);
  });
});

describe('fetchManifest: one request shared by the value card and the map', () => {
  const ok = (run: string) => vi.fn(async () => new Response(JSON.stringify({ run, geometry: '2026-11', cells: [] }), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it('shares a request still in flight and keeps it a minute', async () => {
    const f = ok('A');
    const [a, b] = await Promise.all([fetchManifest('/x', 'r', f, 0), fetchManifest('/x', 'r', f, 10)]);
    expect(a.run).toBe('A'); expect(b.run).toBe('A');
    await fetchManifest('/x', 'r', f, MANIFEST_TTL_MS);
    expect(f).toHaveBeenCalledTimes(1);
    await fetchManifest('/x', 'r', f, MANIFEST_TTL_MS + 1);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('keeps regions apart', async () => {
    const f = ok('A');
    await fetchManifest('/x', 'r1', f, 0); await fetchManifest('/x', 'r2', f, 0);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not keep a failure', async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? new Response('no', { status: 503 }) : new Response(JSON.stringify({ run: 'B' }), { status: 200 }))) as unknown as typeof fetch;
    await expect(fetchManifest('/x', 'r', f, 0)).rejects.toThrow('manifest 503');
    expect((await fetchManifest('/x', 'r', f, 1)).run).toBe('B');
  });
});

describe('preloadFiles: /peta lists its lazy chunks in the HTML', () => {
  const manifest = {
    'index.html': { file: 'assets/index-a.js', isEntry: true, imports: ['_react.js'], dynamicImports: ['src/pages/ExploreMapPage.tsx'] },
    '_react.js': { file: 'assets/vendor-react-b.js' },
    '_motion.js': { file: 'assets/vendor-motion-c.js' },
    '_leaflet.js': { file: 'assets/vendor-leaflet-d.js', css: ['assets/vendor-leaflet-e.css'] },
    'src/pages/ExploreMapPage.tsx': { file: 'assets/ExploreMapPage-f.js', isDynamicEntry: true, imports: ['_react.js', '_motion.js'], dynamicImports: ['src/components/map/LeafletMap.tsx', 'src/pages/Other.tsx'] },
    'src/components/map/LeafletMap.tsx': { file: 'assets/LeafletMap-g.js', isDynamicEntry: true, imports: ['_leaflet.js', '_react.js'] },
    'src/pages/Other.tsx': { file: 'assets/Other-h.js' },
  };
  const html = '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-react-b.js">';

  it('takes the static closure, dependencies first, without what the HTML loads and without dynamic imports', () => {
    const r = preloadFiles(manifest, ['src/pages/ExploreMapPage.tsx', 'src/components/map/LeafletMap.tsx'], referencedAssets(html));
    expect(r.js).toEqual(['assets/vendor-motion-c.js', 'assets/ExploreMapPage-f.js', 'assets/vendor-leaflet-d.js', 'assets/LeafletMap-g.js']);
    expect(r.css).toEqual(['assets/vendor-leaflet-e.css']);
  });
  it('fails on a page missing from the build', () => {
    expect(() => preloadFiles(manifest, ['src/pages/Renamed.tsx'])).toThrow('not in the build manifest');
  });
  it('writes modulepreload, style preload (not a blocking stylesheet) and a classic script preload', () => {
    const tags = preloadTags({ js: ['assets/a.js'], css: ['assets/b.css'] }, ['/vendor/v.js']);
    expect(tags).toContain('<link rel="modulepreload" crossorigin href="/assets/a.js">');
    expect(tags).toContain('<link rel="preload" as="style" crossorigin href="/assets/b.css">');
    expect(tags).toContain('<link rel="preload" as="script" href="/vendor/v.js">');
    expect(tags).not.toContain('rel="stylesheet"');
  });
});

describe('appPreloadScript: the SPA shell preloads the map code of / and /home only (X-W7)', () => {
  const byPath = { '/home': { js: ['assets/HomePage-a.js', 'assets/LeafletMap-b.js'], css: ['assets/vendor-leaflet-c.css'], scripts: ['/vendor/leaflet-vectorgrid.js'] } };
  const run = (pathname: string) => {
    const links: Array<Record<string, string>> = [];
    const document = { head: { appendChild: (e: Record<string, string>) => links.push(e) }, createElement: () => ({}) };
    const code = (appPreloadScript(byPath) as string).replace(/^<script>|<\/script>$/g, '');
    runInNewContext(code, { location: { pathname }, document });
    return links;
  };
  it('adds module preloads, a style preload and the classic script preload on /home', () => {
    const l = run('/home');
    expect(l.filter((e) => e.rel === 'modulepreload').map((e) => [e.href, e.crossOrigin])).toEqual([['/assets/HomePage-a.js', ''], ['/assets/LeafletMap-b.js', '']]);
    expect(l.find((e) => e.as === 'style')).toMatchObject({ rel: 'preload', href: '/assets/vendor-leaflet-c.css', crossOrigin: '' });
    expect(l.find((e) => e.as === 'script')).toMatchObject({ rel: 'preload', href: '/vendor/leaflet-vectorgrid.js' });
    expect(l.find((e) => e.as === 'script')!.crossOrigin).toBeUndefined();
  });
  it('downloads nothing extra on other routes', () => {
    for (const p of ['/', '/prioritas', '/status', '/profile']) expect(run(p)).toEqual([]);
  });
});
