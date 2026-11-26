import { describe, expect, it } from 'vitest';
import { isMinorRoad, opacityFor, tampilDiZoom, weightFor } from '../src/lib/roadColors';

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

  it('M-U02: zoomed out, only main roads and thin; lanes fade at z12-13', () => {
    expect(tampilDiZoom('residential', 11)).toBe(false);
    expect(tampilDiZoom('service', 10)).toBe(false);
    expect(tampilDiZoom('residential', 12)).toBe(true);
    expect(tampilDiZoom('primary', 10)).toBe(true);
    expect(tampilDiZoom('trunk', 10)).toBe(true);
    expect(weightFor('trunk', 11)).toBe(1.2);
    expect(weightFor('secondary', 11)).toBe(0.8);
    expect(weightFor('trunk', 11)).toBeLessThan(weightFor('trunk', 14));
    expect(weightFor('residential', 12)).toBeLessThan(weightFor('residential', 13));
    expect(opacityFor('residential', 12, 0.9)).toBe(0.4);
    expect(opacityFor('residential', 13, 0.9)).toBe(0.5);
    expect(opacityFor('residential', 14, 0.9)).toBe(0.6);
  });
});
