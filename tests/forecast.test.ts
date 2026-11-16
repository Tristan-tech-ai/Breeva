import { describe, expect, it } from 'vitest';
import { decodeExhaust, departHour, encodeExhaust, forecastOffsets, pickForecast, type ForecastEntry } from '../src/lib/field/forecast';

describe('which hours ahead the builder computes', () => {
  it('the next three hours and the next school trip hours, sorted and without repeats', () => {
    // run at 22.00 local: 23, 00, 01, then 07 (+9) and 13 (+15)
    expect(forecastOffsets(22)).toEqual([1, 2, 3, 9, 15]);
    // run at 06.00: 07 is also one hour ahead, so it is not repeated
    expect(forecastOffsets(6)).toEqual([1, 2, 3, 7]);
    // run at 07.00: the next 07 is tomorrow (+24), never 0
    expect(forecastOffsets(7)).toEqual([1, 2, 3, 6, 24]);
  });
});

describe('the hour a departure is judged by', () => {
  it('rounds to the nearest whole hour', () => {
    expect(departHour('06:45')).toBe(7);
    expect(departHour('12:30')).toBe(13);
    expect(departHour('07:10')).toBe(7);
    expect(departHour('23:40')).toBe(0);
    expect(departHour('25:00')).toBeNull();
  });

  it('picks the forecast of that hour; now, the run hour itself or an hour without forecast give none', () => {
    const entries: ForecastEntry[] = [
      { ahead: 1, valid: '2026111615', local_hour: 23, key: 'x2026111615.bin' },
      { ahead: 9, valid: '2026111623', local_hour: 7, key: 'x2026111623.bin' },
    ];
    expect(pickForecast(entries, '06:45', 22)?.key).toBe('x2026111623.bin');
    expect(pickForecast(entries, '23:00', 22)?.ahead).toBe(1);
    expect(pickForecast(entries, null, 22)).toBeNull();
    expect(pickForecast(entries, '22:10', 22)).toBeNull();
    expect(pickForecast(entries, '15:00', 22)).toBeNull();
  });
});

describe('BXF1 exhaust forecast file', () => {
  it('round-trips per cell within the long-tail steps and rejects bad files', () => {
    const cells = [{ c: 0, values: [0, 1.25, 30, 143] }, { c: 7, values: [0.5, 900] }];
    const bytes = encodeExhaust(cells);
    expect(bytes.byteLength).toBe(8 + 6 * 2 + 6);
    const got = decodeExhaust(bytes);
    expect([...got.keys()]).toEqual([0, 7]);
    expect(got.get(0)![1]).toBeCloseTo(1.25, 6);
    expect(got.get(0)![2]).toBeCloseTo(30, 6);
    expect(Math.abs(got.get(0)![3] / 143 - 1)).toBeLessThan(0.03);
    expect(Math.abs(got.get(7)![1] / 900 - 1)).toBeLessThan(0.03);
    expect(() => decodeExhaust(bytes.slice(0, bytes.byteLength - 1))).toThrow();
    const bad = bytes.slice(); bad[0] = 0;
    expect(() => decodeExhaust(bad)).toThrow();
  });
});

describe('forecast of a pack hour', async () => {
  const { readFileSync } = await import('node:fs');
  const { RoadPack } = await import('../scripts/field/pack');
  const { exhaustForHour } = await import('../scripts/field/engine');
  const pack = new RoadPack(new Uint8Array(readFileSync('tests/fixtures/pack_small.bin')));
  const corner = (ws: number) => ({ pm25: 20, pm10: 30, no2: 10, co: 200, o3: 30, wind_speed: ws, wind_direction: 90 });
  const grids = (ws: number) => pack.meta.cells.map((_, c) => ({
    cell: c, bounds: { south: -9, west: 115, north: -8, east: 116 },
    corners: { center: corner(ws), nw: corner(ws), ne: corner(ws), sw: corner(ws), se: corner(ws) },
  }));

  it('more traffic in the morning rush, more exhaust; more wind, less', () => {
    const night = exhaustForHour(pack, grids(2), 2, 0.08), rush = exhaustForHour(pack, grids(2), 7, 1.2);
    expect(rush[0]).toBeGreaterThan(night[0] * 5);
    const windy = exhaustForHour(pack, grids(6), 7, 1.2);
    expect(windy[0]).toBeLessThan(rush[0]);
    expect(rush.length).toBe(pack.n);
  });
});

describe('router field at the departure hour', async () => {
  const { edgeExhaust, no2AtHour, meanAlong, bestSoon } = await import('../src/lib/route/departForecast');
  const { routeCards } = await import('../src/lib/route/summary');

  it('swaps only the traffic part of NO2 and keeps edges without data', () => {
    const g = { m: 3, road: (e: number) => (e === 2 ? null : { c: 5, i: e }) };
    const x = edgeExhaust(g, new Map([[5, Float32Array.from([2, 40])]]));
    expect(Array.from(x.slice(0, 2))).toEqual([2, 40]);
    expect(Number.isNaN(x[2])).toBe(true);
    const n = no2AtHour(Float64Array.from([30, 35, 20]), Float64Array.from([5, 10, Number.NaN]), x);
    expect(Array.from(n)).toEqual([27, 65, 20]); // 30-5+2, 35-10+40, no data: unchanged
  });

  it('mean along a route is weighted by edge length', () => {
    const g = { lenDm: Uint16Array.from([1000, 3000]) }; // 100 m and 300 m
    expect(meanAlong(g, [0, 1], 400 / 1.3, 400, Float64Array.from([4, 8]))).toBeCloseTo(7, 9);
  });

  it('suggests another hour only when it is at least 10% cleaner', () => {
    expect(bestSoon(10, [{ local_hour: 23, ahead: 1, exhMean: 9.5 }])).toBeNull();
    expect(bestSoon(10, [{ local_hour: 23, ahead: 1, exhMean: 9.5 }, { local_hour: 0, ahead: 2, exhMean: 6 }])).toEqual({ hour: { local_hour: 0, ahead: 2, exhMean: 6 }, pct: 40 });
    expect(bestSoon(0.2, [{ local_hour: 0, ahead: 2, exhMean: 0.01 }])).toBeNull();
  });

  it('cards say which hour a later departure was computed for, and the better hour when leaving now', () => {
    const base = { lengthM: 1000, timeS: 800, no2Mean: 30, pm25Mean: 25, coords: [], w: 0 };
    const later = routeCards([{ ...base, exhMean: 12, forecastHour: 7 }]);
    expect(later[0].forecastNote).toBe('Perkiraan untuk sekitar jam 07.00: angin prakiraan dan pola lalu lintas jam itu');
    expect(later[0].soonHint).toBeNull();
    const now = routeCards([{ ...base, exhMean: 12, forecastHour: null, soon: [{ local_hour: 22, ahead: 1, exhMean: 7.2 }] }]);
    expect(now[0].forecastNote).toBeNull();
    expect(now[0].soonHint).toBe('Berangkat sekitar jam 22.00 lewat rute ini: asap kendaraan 40% lebih sedikit daripada berangkat sekarang');
  });
});
