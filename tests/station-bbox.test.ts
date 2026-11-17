import { describe, expect, it } from 'vitest';
import { bboxParam, CELL_DEG, coarseBbox } from '../src/lib/stationBbox';

// the view sent when a route link in Denpasar opened (breeva.site, 17 Nov 2026)
const view = { south: -8.680645341821375, west: 115.2045249938965, north: -8.660366243843464, east: 115.22066116333009 };

describe('area asked from the station proxy (F1-22)', () => {
  it('widens the view outward to whole 0.25 degree cells', () => {
    const b = coarseBbox(view);
    expect(b).toEqual({ south: -8.75, west: 115, north: -8.5, east: 115.25 });
    expect(b.south).toBeLessThanOrEqual(view.south);
    expect(b.west).toBeLessThanOrEqual(view.west);
    expect(b.north).toBeGreaterThanOrEqual(view.north);
    expect(b.east).toBeGreaterThanOrEqual(view.east);
    expect(CELL_DEG).toBeGreaterThanOrEqual(0.1);
  });

  it('the same cell answers small pans, so the request does not reveal where inside the city the view is', () => {
    const moved = { south: view.south + 0.01, west: view.west - 0.02, north: view.north + 0.01, east: view.east - 0.02 };
    expect(coarseBbox(moved)).toEqual(coarseBbox(view));
  });

  it('writes no more than the grid precision, in the proxy order south,west,north,east', () => {
    const s = bboxParam(coarseBbox(view));
    expect(s).toBe('-8.75,115,-8.5,115.25');
    for (const part of s.split(',')) expect((part.split('.')[1] ?? '').length).toBeLessThanOrEqual(2);
  });

  it('an edge that falls exactly on the grid still gets a cell of its own', () => {
    const b = coarseBbox({ south: -8.5, west: 115, north: -8.25, east: 115.25 });
    expect(b.north).toBeGreaterThan(-8.25);
    expect(b.east).toBeGreaterThan(115.25);
  });
});
