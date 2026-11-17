import { describe, expect, it } from 'vitest';
import { withSoon, type WalkRoute } from '../src/lib/route/client';
import { routeCards } from '../src/lib/route/summary';

const r = (timeS: number, exhMean: number): WalkRoute => ({ lengthM: timeS * 1.3, timeS, pm25Mean: 30, no2Mean: 20, exhMean, coords: [], w: 0 });

describe('leave-later hint arriving after the routes (F3-18)', () => {
  it('attaches the hours to the last (cleanest) route only, without touching the others', () => {
    const routes = [r(600, 10), r(660, 4)];
    const soon = [{ local_hour: 7, ahead: 1, exhMean: 2 }, { local_hour: 8, ahead: 2, exhMean: 3 }];
    const out = withSoon(routes, soon);
    expect(out[1].soon).toEqual(soon);
    expect(out[0].soon).toBeUndefined();
    expect(routes[1].soon).toBeUndefined(); // the original cards' routes stay as they were
    expect(out[0]).toBe(routes[0]);
  });

  it('nothing to attach: the same routes back', () => {
    const routes = [r(600, 10)];
    expect(withSoon(routes, [])).toBe(routes);
    expect(withSoon(routes, null)).toBe(routes);
    expect(withSoon([], [{ local_hour: 7, ahead: 1, exhMean: 1 }])).toEqual([]);
  });

  it('the cards show the hint only once the hours arrive, and the numbers of the routes do not change', () => {
    const routes = [r(600, 10), r(660, 4)];
    const before = routeCards(routes);
    const after = routeCards(withSoon(routes, [{ local_hour: 7, ahead: 1, exhMean: 1 }]));
    expect(before[1].soonHint).toBeNull();
    expect(after[1].headline).toBe(before[1].headline);
    expect(after[1].minutes).toBe(before[1].minutes);
    // 4 now vs 1 at 07.00 on the same route: 75% less
    expect(after[1].soonHint).toMatch(/^Berangkat sekitar jam 07\.00 lewat rute ini: asap kendaraan 75% lebih sedikit/);
  });
});
