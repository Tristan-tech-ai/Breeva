import { describe, expect, it } from 'vitest';
import { nearestFeature, tileFraction, unitsPerPixel, type TileFeature } from '../src/lib/field/tap';

const road = (c: number, pts: Array<[number, number]>): TileFeature => ({ geometry: [pts.map(([x, y]) => ({ x, y }))], properties: { c, i: 0 }, extent: 4096 });

describe('tapping a road of the static field', () => {
  const feats = [road(1, [[0, 0], [4096, 0]]), road(2, [[0, 100], [4096, 100]]), road(3, [[2000, 3000], [2000, 3000]])];

  it('picks the nearest line within the tolerance', () => {
    expect(nearestFeature(feats, 2000, 30, 50)!.feature.properties.c).toBe(1);
    expect(nearestFeature(feats, 2000, 70, 50)!.feature.properties.c).toBe(2);
    expect(nearestFeature(feats, 2000, 3010, 50)!.feature.properties.c).toBe(3); // a one-point stub
  });

  it('returns nothing when no road is close enough', () => {
    expect(nearestFeature(feats, 2000, 600, 50)).toBeNull();
    expect(nearestFeature([], 0, 0, 50)).toBeNull();
  });

  it('measures to the segment, not only its end points', () => {
    expect(nearestFeature([road(9, [[0, 0], [4000, 4000]])], 2000, 2050, 40)!.dist).toBeCloseTo(50 / Math.SQRT2, 6);
  });

  it('tile coordinates and tolerance scale with zoom', () => {
    // Denpasar centre at z14: tile (13435, 8588), the same as vayu/field/pack.py tile_xy (13435.45, 8588.12)
    const f = tileFraction(-8.6705, 115.2126, 14);
    expect([Math.floor(f.x), Math.floor(f.y)]).toEqual([13435, 8588]);
    expect(f.x).toBeCloseTo(13435.4534, 3);
    expect(f.y).toBeCloseTo(8588.1189, 3);
    expect(unitsPerPixel(4096, 14, 14)).toBe(16);
    expect(unitsPerPixel(4096, 14, 16)).toBe(4); // overzoomed: a pixel covers fewer tile units
  });
});
