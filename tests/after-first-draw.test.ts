import { describe, expect, it } from 'vitest';
import { afterFirstDraw, markFieldDrawn } from '../src/lib/field/firstDraw';
import { FIELD_DRAWN_EVENT } from '../src/lib/field/source';

// F1-69: the POI pack waits until the coloured map is drawn, and does not wait at all once it was.
describe('afterFirstDraw', () => {
  it('waits for the field to draw, then resolves', async () => {
    const t = new EventTarget();
    let done = false;
    const p = afterFirstDraw(t, 10_000).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    t.dispatchEvent(new Event(FIELD_DRAWN_EVENT));
    await p;
    expect(done).toBe(true);
  });

  it('resolves at once when the field was already drawn on that target', async () => {
    const t = new EventTarget();
    markFieldDrawn(t);
    let done = false;
    await afterFirstDraw(t, 10_000).then(() => { done = true; });
    expect(done).toBe(true);
  });

  it('gives up waiting after the fallback time', async () => {
    const t = new EventTarget();
    const t0 = Date.now();
    await afterFirstDraw(t, 30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});
