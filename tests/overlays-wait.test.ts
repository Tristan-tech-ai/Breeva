import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OVERLAYS_FALLBACK_MS, overlaysWait } from '../src/lib/overlaysWait';

// X-W62: framer-motion (42 KB on the wire) off the route link's first load: the /peta components animate in CSS and the
// app-wide overlays mount after the first field draw on map pages.
describe('overlays on map pages', () => {
  it('wait on the pages that open on the map, not elsewhere', () => {
    for (const p of ['/', '/peta', '/peta/', '/home']) expect(overlaysWait(p)).toBe(true);
    for (const p of ['/status', '/uji-coba', '/prioritas', '/validasi', '/login', '/petak']) expect(overlaysWait(p)).toBe(false);
    expect(OVERLAYS_FALLBACK_MS).toBeGreaterThanOrEqual(20_000); // the offline banner still comes if nothing draws
  });

  it('mount through afterFirstDraw in App', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/afterFirstDraw\(window, OVERLAYS_FALLBACK_MS\)/);
    expect(app).toMatch(/<OverlaysWhenReady \/>/);
    expect(app).not.toMatch(/<Suspense fallback=\{null\}>\s*<AppOverlays \/>\s*<\/Suspense>\s*<Toaster/);
  });

  it('keeps framer-motion out of the components a route link draws first', () => {
    for (const f of ['src/components/features/AQICard.tsx', 'src/components/map/SearchBar.tsx', 'src/components/map/GCNConfidenceLegend.tsx', 'src/pages/ExploreMapPage.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/from 'framer-motion'/);
    }
    const css = readFileSync('src/index.css', 'utf8');
    for (const c of ['anim-turun', 'anim-naik', 'anim-buka']) expect(css).toContain(`.${c} {`);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.anim-turun, \.anim-naik, \.anim-buka \{ animation: none; \}/);
  });
});
