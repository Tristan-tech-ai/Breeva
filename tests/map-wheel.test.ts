import { describe, expect, it } from 'vitest';
import { NOTCH_PX, wheelStep } from '../src/lib/map/wheel';

const ev = (deltaY: number, mod: 'none' | 'ctrl' | 'meta' = 'ctrl', deltaMode = 0) =>
  ({ deltaY, deltaMode, ctrlKey: mod === 'ctrl', metaKey: mod === 'meta' });

describe('wheel over an embedded map', () => {
  it('without a modifier the page scrolls and the map shows the hint', () => {
    expect(wheelStep(0, ev(120, 'none'))).toEqual({ acc: 0, step: 0, hint: true });
    expect(wheelStep(80, ev(-120, 'none'))).toEqual({ acc: 0, step: 0, hint: true });
  });

  it('one mouse notch with Ctrl or Cmd is one zoom level, up zooms in', () => {
    expect(wheelStep(0, ev(-NOTCH_PX))).toEqual({ acc: 0, step: 1, hint: false });
    expect(wheelStep(0, ev(NOTCH_PX, 'meta'))).toEqual({ acc: 0, step: -1, hint: false });
    expect(wheelStep(0, ev(3, 'ctrl', 1)).step).toBe(0); // 3 lines = 48 px, not yet a level
    expect(wheelStep(0, ev(-1, 'ctrl', 2)).step).toBe(1); // a page
  });

  it('a trackpad pinch accumulates small deltas into one level', () => {
    let acc = 0, steps = 0;
    for (let k = 0; k < 30; k++) { const r = wheelStep(acc, ev(-8)); acc = r.acc; steps += r.step; }
    expect(steps).toBe(2); // 240 px of pinch
    expect(acc).toBeCloseTo(-40, 6);
  });
});
