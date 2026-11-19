import { describe, expect, it } from 'vitest';
import { walkRouteCoords } from '../src/lib/walkRoute';

// X-W60: a stored walk's saved route must be drawn; the straight origin-destination line is only the fallback.
describe('stored walk route line', () => {
  const ends = { origin_lat: -8.67, origin_lng: 115.21, destination_lat: -8.68, destination_lng: 115.23 };

  it('draws the saved polyline, in both stored shapes', () => {
    expect(walkRouteCoords({ ...ends, route_polyline: JSON.stringify([[-8.67, 115.21], [-8.675, 115.22], [-8.68, 115.23]]) })).toHaveLength(3);
    expect(walkRouteCoords({ ...ends, route_polyline: JSON.stringify([{ lat: -8.67, lng: 115.21 }, { lat: -8.68, lng: 115.23 }]) }))
      .toEqual([[-8.67, 115.21], [-8.68, 115.23]]);
  });

  it('falls back to the straight line without a usable polyline', () => {
    expect(walkRouteCoords({ ...ends, route_polyline: null })).toEqual([[-8.67, 115.21], [-8.68, 115.23]]);
    expect(walkRouteCoords({ ...ends, route_polyline: 'not json' })).toEqual([[-8.67, 115.21], [-8.68, 115.23]]);
    expect(walkRouteCoords({ ...ends, route_polyline: JSON.stringify([[-8.67, 115.21]]) })).toHaveLength(2); // one point is no line
  });

  it('has no line without ends either', () => {
    expect(walkRouteCoords({ route_polyline: null })).toEqual([]);
  });
});
