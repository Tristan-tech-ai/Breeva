import { describe, expect, it } from 'vitest';
import { regionGate, ROUTE_SETTLED_EVENT, routeSettled } from '../src/lib/field/firstDraw';

// F1-63: on a route link the region in view also waits for the first route, so its road tiles do not share a slow link
// with the walking graph the route card needs; other pages draw the region in view at once.
const state = (p: Promise<void>) => Promise.race([p.then(() => 'selesai'), new Promise<string>((r) => setTimeout(() => r('menunggu'), 20))]);

describe('regionGate', () => {
  it('lets the region in view load at once when no route link is open', async () => {
    expect(await state(regionGate(0, false, new Promise(() => {})))).toBe('selesai');
  });
  it('holds the region in view on a route link until the route has settled', async () => {
    const target = new EventTarget();
    const gate = regionGate(0, true, Promise.resolve(), () => routeSettled(target, 60_000));
    expect(await state(gate)).toBe('menunggu');
    target.dispatchEvent(new Event(ROUTE_SETTLED_EVENT));
    expect(await state(gate)).toBe('selesai');
  });
  it('still lets the region in view go after the fallback time if the route never settles', async () => {
    const gate = regionGate(0, true, Promise.resolve(), () => routeSettled(new EventTarget(), 10));
    expect(await state(gate)).toBe('selesai');
  });
  it('keeps the other regions behind othersGo, route link or not', async () => {
    let go: () => void = () => {};
    const others = new Promise<void>((r) => { go = r; });
    for (const waitRoute of [false, true]) expect(await state(regionGate(1, waitRoute, others))).toBe('menunggu');
    go();
    expect(await state(regionGate(2, true, others))).toBe('selesai');
  });
});
