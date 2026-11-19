import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W52: on /peta the bottom-left route button covered the start of the map attribution (data sources must stay
// visible). The map wrapper carries peta-tombol-kiri and the attribution then leaves room for the button.
const PAGE = readFileSync('src/pages/ExploreMapPage.tsx', 'utf8');
const CSS = readFileSync('src/index.css', 'utf8');

describe('map attribution next to the route button', () => {
  it('marks the map wrapper when the route button is shown', () => {
    expect(PAGE).toMatch(/FIELD_STATIC \? ' peta-tombol-kiri' : ''/);
    expect(PAGE).toMatch(/absolute left-3 bottom-3/); // the button the rule makes room for
  });

  it('keeps the attribution right of the button (left 12 px + about 150 px)', () => {
    const m = /\.peta-tombol-kiri \.leaflet-bottom\.leaflet-right \.leaflet-control-attribution \{\s*max-width: calc\(100% - (\d+)px\);/.exec(CSS);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(165);
  });
});
