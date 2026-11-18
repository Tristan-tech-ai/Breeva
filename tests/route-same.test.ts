import { describe, expect, it } from 'vitest';
import { sameRoute } from '../src/lib/route/sameRoute';
import { announceRoutes, routeCards, SAME_AS_FASTEST } from '../src/lib/route/summary';

// F1-58: at 07.00 on the demo link (18 Nov) the motor emergency search and the two-number search found the same route,
// the worker showed it once, and nothing on screen said why the emergency card was missing.
const motor = (kind: 'dua-angka' | 'darurat', extra: Record<string, unknown> = {}) => ({
  lengthM: 4070, timeS: 540, no2Mean: 20, pm25Mean: 26, exhMean: 17.3, coords: [], w: 1, kind, hargaMean: 0.96, ...extra,
});

describe('same motor route', () => {
  it('compares edges in order, not as a set', () => {
    expect(sameRoute({ edges: [1, 2, 3] }, { edges: [1, 2, 3] })).toBe(true);
    expect(sameRoute({ edges: Int32Array.from([1, 2, 3]) }, { edges: [1, 2, 3] })).toBe(true);
    expect(sameRoute({ edges: [1, 2, 3] }, { edges: [1, 3, 2] })).toBe(false);
    expect(sameRoute({ edges: [1, 2] }, { edges: [1, 2, 3] })).toBe(false);
    expect(sameRoute({ edges: [] }, { edges: [] })).toBe(true);
  });

  it('says on the card and to screen readers that the emergency route is the same one', () => {
    const cards = routeCards([motor('dua-angka', { sameAsFastest: true })]);
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Dua angka (disarankan)');
    expect(cards[0].sameNote).toBe(SAME_AS_FASTEST);
    expect(announceRoutes(cards, '')).toContain(SAME_AS_FASTEST);
  });

  it('says nothing when the two routes differ, or for walking routes', () => {
    const two = routeCards([motor('darurat'), motor('dua-angka', { lengthM: 4300 })]);
    expect(two.map((c) => c.sameNote)).toEqual([null, null]);
    expect(announceRoutes(two, '')).not.toContain('sama dengan rute ini');
    // the flag on anything but the two-number route is ignored
    expect(routeCards([motor('darurat', { sameAsFastest: true })])[0].sameNote).toBeNull();
    const walk = routeCards([{ lengthM: 2800, timeS: 2160, no2Mean: 15, pm25Mean: 26, coords: [], w: 0, sameAsFastest: true }]);
    expect(walk[0].sameNote).toBeNull();
  });
});
