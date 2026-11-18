import { describe, expect, it } from 'vitest';
import { isMinorRoad, opacityFor, weightFor } from '../src/lib/roadColors';

// F1-70: lanes thin and quiet until zoomed in; main roads unchanged (Tristan, 18 Nov 2026: the map was a mesh of colour).
describe('road line style', () => {
  it('keeps lanes thin below z16 and grows them as the user zooms in', () => {
    expect(isMinorRoad('residential')).toBe(true);
    expect(weightFor('residential', 15)).toBeLessThanOrEqual(1.0);
    expect(weightFor('residential', 14)).toBeLessThan(weightFor('residential', 15));
    expect(weightFor('residential', 17)).toBeGreaterThanOrEqual(2.0);
    expect(weightFor('residential', 22)).toBe(2.6);
  });

  it('draws main roads clearly wider than lanes at every zoom', () => {
    for (const z of [13, 14, 15, 16, 17, 18]) {
      const lane = weightFor('residential', z);
      const major = ['primary', 'trunk', 'motorway', 'secondary'].map((h) => weightFor(h, z));
      expect(Math.max(...major)).toBeGreaterThan(lane * 1.5);
    }
  });

  it('makes lanes quieter below z16 only', () => {
    expect(opacityFor('residential', 15, 0.9)).toBe(0.6);
    expect(opacityFor('residential', 16, 0.9)).toBe(0.9);
    expect(opacityFor('residential', 15, 0.5)).toBe(0.5);
    expect(opacityFor('trunk', 15, 0.9)).toBe(0.9);
  });
});
