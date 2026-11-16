import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoadPack } from '../scripts/field/pack';

// Fixture written by vayu/field/make_fixture.py with the Python writer (vayu/field/pack.py).
const bytes = new Uint8Array(readFileSync('tests/fixtures/pack_small.bin'));
const want = JSON.parse(readFileSync('tests/fixtures/pack_small.json', 'utf8')) as {
  n: number;
  rows: Array<{ c: number; i: number; osm_way_id: number; highway: string; coords: number[][]; neighbours: number[]; lanes: number | null; name: string | null }>;
};

describe('road pack reader (TypeScript) against the Python writer', () => {
  const p = new RoadPack(bytes);

  it('reads the header', () => {
    expect(p.meta.format).toBe('BRP1');
    expect(p.n).toBe(want.n);
  });

  it('reads every road identically', () => {
    want.rows.forEach((r, k) => {
      expect(p.id(k)).toEqual({ c: r.c, i: r.i });
      expect(p.col('osm_way_id')[k]).toBe(r.osm_way_id);
      expect(p.highway(k)).toBe(r.highway);
      expect(p.num('lanes', k)).toBe(r.lanes);
      expect(p.str('name', k)).toBe(r.name);
      expect(Array.from(p.neighbours(k))).toEqual(r.neighbours);
      const got = p.coords(k);
      expect(got.length).toBe(r.coords.length);
      got.forEach((xy, j) => {
        expect(xy[0]).toBeCloseTo(r.coords[j][0], 9);
        expect(xy[1]).toBeCloseTo(r.coords[j][1], 9);
      });
    });
  });

  it('rejects a file that is not a pack', () => {
    expect(() => new RoadPack(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow();
  });
});
