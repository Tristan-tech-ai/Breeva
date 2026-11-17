import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W13: white 12 px bold text on sky-600 is under the WCAG AA 4.5:1 for normal text (axe-core 4.14.0 on the route card
// while the download message shows, aksesibilitas_ulang_2026-11-18.json); the selected pills use sky-700.
describe('selected pills keep their text readable', () => {
  it('never put white text on sky-600 in the map pages', () => {
    for (const f of ['src/pages/ExploreMapPage.tsx', 'src/pages/HomePage.tsx']) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/bg-sky-600 text-white/);
      expect(s, f).toMatch(/bg-sky-700 text-white/);
    }
  });
});
