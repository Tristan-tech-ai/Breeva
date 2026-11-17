import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deviceRouteAsRoute, deviceRouteStart, fieldRegionOf, routeModeFor, transportFor } from '../src/lib/route/appRoute';

const denpasar = { lat: -8.6705, lng: 115.2126 }, kuta = { lat: -8.7177, lng: 115.1707 };
const bogor = { lat: -6.595, lng: 106.797 }, jakarta = { lat: -6.2088, lng: 106.8456 };

describe('in-app map on the on-device engine (F1-18)', () => {
  it('destinations route on the device only inside a field region', () => {
    expect(fieldRegionOf(denpasar)?.name).toBe('badung_denpasar');
    expect(fieldRegionOf(bogor)?.name).toBe('kota_bogor');
    expect(fieldRegionOf(jakarta)).toBeNull();
    expect(fieldRegionOf(null)).toBeNull();
    expect(fieldRegionOf({ lat: NaN, lng: 115.2 })).toBeNull();
  });

  it('the GPS position starts the route when it lies in the destination region, else the user taps', () => {
    expect(deviceRouteStart(kuta, denpasar)).toEqual(kuta);
    expect(deviceRouteStart(bogor, denpasar)).toBeNull(); // other region
    expect(deviceRouteStart(jakarta, denpasar)).toBeNull(); // outside every region
    expect(deviceRouteStart(null, denpasar)).toBeNull(); // no GPS
    expect(deviceRouteStart(kuta, jakarta)).toBeNull(); // destination outside: no device route at all
  });

  it('only walking and motorbike have device graphs', () => {
    expect(routeModeFor('motorcycle')).toBe('motor');
    expect(routeModeFor('walking')).toBe('walk');
    expect(routeModeFor('car')).toBe('walk');
    expect(transportFor('motor')).toBe('motorcycle');
    expect(transportFor('walk')).toBe('walking');
  });

  it('the chosen device route becomes the app Route that walk tracking follows', () => {
    const r = deviceRouteAsRoute(
      { lengthM: 1234.4, timeS: 905.6, pm25Mean: 21.3, no2Mean: 30, coords: [[115.2126, -8.6705], [115.215, -8.672]], w: 0 },
      { id: 'r1', userId: 'guest', cleanest: true, avgAqi: 70, points: 15, now: new Date('2026-11-16T00:00:00Z') },
    );
    expect(r.waypoints).toEqual([{ lat: -8.6705, lng: 115.2126 }, { lat: -8.672, lng: 115.215 }]);
    expect(r).toMatchObject({
      id: 'r1', user_id: 'guest', distance_meters: 1234, duration_seconds: 906, avg_aqi: 70, eco_points_earned: 15,
      route_type: 'eco', instructions: [], start_point: { lat: -8.6705, lng: 115.2126 }, end_point: { lat: -8.672, lng: 115.215 },
    });
  });

  it('home: road colours by traffic by default, and routing in field regions does not call the server', () => {
    const home = readFileSync('src/pages/HomePage.tsx', 'utf8');
    expect(home).toMatch(/useState<RoadDisplayMode>\('traffic'\)/);
    expect(home).toMatch(/walkRouting=\{deviceRouting\}/);
    expect(home).toMatch(/routeStart=\{routeStart\}/);
  });
});

describe('"Pakai lokasiku" starts the route on /peta (F3-14)', async () => {
  const { locationStart } = await import('../src/lib/route/appRoute');
  it('uses the position when it is in the school region, and says why when it cannot', () => {
    expect(locationStart(bogor, { lat: -6.59733, lng: 106.79335 }).start).toEqual(bogor);
    expect(locationStart(bogor, { lat: -6.59733, lng: 106.79335 }).note).toMatch(/Berangkat dari lokasimu/);
    expect(locationStart(jakarta, { lat: -6.59733, lng: 106.79335 })).toEqual({ start: null, note: expect.stringMatching(/di luar wilayah/) });
    expect(locationStart(bogor, null)).toEqual({ start: null, note: expect.stringMatching(/setelah sekolah tujuan dipilih/) });
    expect(locationStart(null, denpasar, 'User denied Geolocation')).toEqual({ start: null, note: expect.stringMatching(/izin ditolak/) });
    expect(locationStart(null, denpasar)).toEqual({ start: null, note: null });
  });
});
