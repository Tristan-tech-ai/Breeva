import { describe, expect, it } from 'vitest';
import { bboxOf, boxRanges, chunkPlan, joinTime, nearest, sample, type OmBox } from '../src/lib/nasional/omgrid';
import { camsFromBox } from '../src/lib/nasional/latar';
import { windAt, windFromBoxes } from '../src/lib/nasional/angin';

const camsWkt = 'GEOGCRS["WGS 84", USAGE[ SCOPE["grid"], BBOX[-90.0,-180.0,90.0,179.6]]]';

describe('N-36 grids of the Open-Meteo open data', () => {
  it('reads the BBOX of meta.json and finds the rows and columns of the Indonesia box', () => {
    expect(bboxOf({ crs_wkt: camsWkt })).toEqual([-90, -180, 90, 179.6]);
    expect(bboxOf({})).toBeNull();
    const r = boxRanges(451, 900, [94.5, -11.5, 141.5, 6.5], bboxOf({ crs_wkt: camsWkt }));
    expect(r.dlat).toBeCloseTo(0.4, 9);
    expect(r.dlon).toBeCloseTo(0.4, 9);
    expect(r.lat0).toBeLessThanOrEqual(-11.5);
    expect(r.lat0 + (r.r1 - r.r0 - 1) * r.dlat).toBeGreaterThanOrEqual(6.5);
    expect(r.lon0).toBeLessThanOrEqual(94.5);
    expect(r.lon0 + (r.c1 - r.c0 - 1) * r.dlon).toBeGreaterThanOrEqual(141.5);
  });
  it('plans the chunk files of a window, across a chunk border', () => {
    const m = { chunk_time_length: 217, temporal_resolution_seconds: 3600 };
    const s = 2298 * 217 + 200; // 17 steps before the end of chunk 2298
    expect(chunkPlan(m, s * 3600, 48)).toEqual([{ chunk: 2298, start: 200, end: 217 }, { chunk: 2299, start: 0, end: 31 }]);
    expect(chunkPlan({ chunk_time_length: 104, temporal_resolution_seconds: 10800 }, 104 * 10800 * 5 + 10800 * 3, 9)).toEqual([{ chunk: 5, start: 3, end: 12 }]);
  });
  it('joins two reads along time for every cell', () => {
    const a = new Float32Array([1, 2, 10, 20]); // 2 cells x 2 steps
    const b = new Float32Array([3, 30]); // 2 cells x 1 step
    expect([...joinTime([a, b], 1, 2, [2, 1])]).toEqual([1, 2, 3, 10, 20, 30]);
  });
  const box: OmBox = { lat0: -8.8, lon0: 115.2, dlat: 0.4, dlon: 0.4, ny: 2, nx: 2, times: [0, 3600], data: new Float32Array([10, 11, 20, 21, 30, 31, 40, 41]) };
  it('takes the nearest cell as the API does, and interpolates when asked', () => {
    expect(nearest(box, 115.22, -8.65, 0)).toBe(10); // nearest to (-8.8, 115.2)
    expect(nearest(box, 115.5, -8.5, 1)).toBe(41); // ties go north/east
    expect(sample(box, 115.4, -8.6, 0)).toBeCloseTo(25, 9);
    expect(Number.isNaN(nearest(box, 120, -8.6, 0))).toBe(true);
  });
  it('gives one CAMS series per centre, rounded, null outside the box', () => {
    const c = camsFromBox(box, [{ lon: 115.22, lat: -8.65 }, { lon: 130, lat: 0 }]);
    expect(c.hours).toEqual(['1970-01-01T00:00Z', '1970-01-01T01:00Z']);
    expect(c.series).toEqual([[10, 11], [null, null]]);
  });
  it('turns 3-hourly u/v into an hourly wind file with the direction the wind comes from', () => {
    const grid = { lon0: 115, lat0: -9, step: 1, nx: 2, ny: 2 };
    const mk = (vals: [number, number]): OmBox => ({ lat0: -10, lon0: 114, dlat: 1, dlon: 1, ny: 4, nx: 4, times: [0, 10800], data: new Float32Array(Array.from({ length: 16 }, () => vals).flat()) });
    const w = windFromBoxes(mk([3, 0]), mk([0, 0]), grid, new Date(0)); // u = 3 m/s eastward, falling to 0 over 3 hours
    expect(w.hours).toHaveLength(4);
    expect(w.speed[0]).toEqual([3, 2, 1, 0]);
    expect(w.dir[0][0]).toBe(270); // blowing east = coming from the west
    expect(windAt(w, 115.5, -8.5, 1)).toEqual({ speed: 2, from: 270 });
  });
});
