import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_FAILED_EVENT, FIRST_DRAW_FALLBACK_MS, onFirstDraw } from '../src/lib/field/firstDraw';
import { fetchManifest, FIELD_DRAWN_EVENT, MANIFEST_TTL_MS } from '../src/lib/field/source';
// @ts-expect-error plain ES module used by the build (prerender-routes.mjs)
import { preloadFiles, preloadTags, referencedAssets } from '../preload-links.mjs';

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
