import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHEET_HEIGHTS, sheetLift } from '../src/lib/sheetHeights';

// X-W54: on /home the bottom sheet (28% of the screen when peeking) covered the whole map attribution. The map's bottom
// controls now sit at the sheet's height.
const HOME = readFileSync('src/pages/HomePage.tsx', 'utf8');
const SHEET = readFileSync('src/components/map/BottomSheet.tsx', 'utf8');
const CSS = readFileSync('src/index.css', 'utf8');

describe('home map attribution above the bottom sheet', () => {
  it('lifts by the sheet height of each state', () => {
    expect(sheetLift('peek')).toBe('28vh');
    expect(sheetLift('half')).toBe('50vh');
    expect(sheetLift('full')).toBe('88vh');
    expect(sheetLift('hidden')).toBe('0vh');
  });

  it('uses the same heights as the sheet itself', () => {
    expect(SHEET).toMatch(/import \{ SHEET_HEIGHTS \} from '..\/..\/lib\/sheetHeights'/);
    expect(SHEET).not.toMatch(/const SHEET_HEIGHTS =/);
    expect(Object.keys(SHEET_HEIGHTS).sort()).toEqual(['full', 'half', 'hidden', 'peek']);
  });

  it('sets --sheet-h on the home map and the CSS reads it', () => {
    expect(HOME).toMatch(/home-map relative h-screen/);
    expect(HOME).toMatch(/'--sheet-h': sheetLift\(bottomSheetState\)/);
    expect(CSS).toMatch(/\.home-map \.leaflet-bottom \{\s*bottom: var\(--sheet-h, 0px\);/);
  });

  it('leaves room for the round buttons at the right edge', () => {
    const m = /\.home-map \.leaflet-bottom\.leaflet-right \.leaflet-control-attribution \{\s*margin-right: (\d+)px;/.exec(CSS);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16 + 40 + 4); // right-4 and the 40 px button
  });
});
