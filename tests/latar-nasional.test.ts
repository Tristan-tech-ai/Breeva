import { describe, expect, it } from 'vitest';
import { camsSeries, camsUrl, latarFile, sensorsNow, LATAR_HOURS } from '../src/lib/nasional/latar';

const now = new Date('2026-11-25T11:20:00Z');
const hours = Array.from({ length: LATAR_HOURS }, (_, k) => `2026-11-${String(25 + Math.floor((11 + k) / 24)).padStart(2, '0')}T${String((11 + k) % 24).padStart(2, '0')}:00`);
const ans = (base: number) => ({ hourly: { time: hours, pm2_5: hours.map((_, k) => base + k) } });

const centres = [
  { slug: 'kota-denpasar', lon: 115.22, lat: -8.66 }, // sensors 5 km away
  { slug: 'kabupaten-tabanan', lon: 114.95, lat: -8.35 }, // ~40 km: no close sensor, 2 within 150 km
  { slug: 'kabupaten-merauke', lon: 140.4, lat: -8.0 }, // nothing near
];
const latest = (rows: Array<[number, number, number, string]>) => ({ results: rows.map(([lat, lon, v, t]) => ({ datetime: { utc: t }, value: v, coordinates: { latitude: lat, longitude: lon } })) });

describe('N-22 background PM2.5 per kab/kota', () => {
  it('asks Open-Meteo for all points of a chunk with 48 hours', () => {
    const u = camsUrl(centres);
    expect(u).toContain('latitude=-8.660,-8.350,-8.000');
    expect(u).toContain('longitude=115.220,114.950,140.400');
    expect(u).toContain('forecast_hours=48');
  });
  it('flattens chunked answers, single objects too, into one series per point', () => {
    const c = camsSeries([[ans(20), ans(30)], ans(40)]);
    expect(c.series).toHaveLength(3);
    expect(c.series[2][0]).toBe(40);
    expect(c.hours[0]).toBe('2026-11-25T11:00Z');
    expect(c.hours).toHaveLength(48);
  });
  it('keeps only fresh, plausible sensors inside Indonesia', () => {
    const s = sensorsNow([latest([
      [-8.65, 115.2, 30, '2026-11-25T10:00:00Z'], // ok
      [-8.65, 115.2, 30, '2026-11-25T06:00:00Z'], // 5 h old
      [-8.65, 115.2, 0, '2026-11-25T10:00:00Z'], // zero
      [40.1, 117.0, 30, '2026-11-25T10:00:00Z'], // China
      [-8.65, 115.2, 5000, '2026-11-25T10:00:00Z'], // implausible
    ])], now);
    expect(s).toEqual([{ lon: 115.2, lat: -8.65, pm25: 30 }]);
  });
  it('labels terukur, terkalibrasi and indikatif and scales the 48 hours by one ratio', () => {
    const cams = camsSeries([[ans(20), ans(25), ans(10)]]);
    const sensors = [{ lon: 115.25, lat: -8.68, pm25: 40 }, { lon: 115.18, lat: -8.63, pm25: 40 }];
    const f = latarFile(centres, cams, sensors, now);
    const d = f.wilayah['kota-denpasar'], t = f.wilayah['kabupaten-tabanan'], m = f.wilayah['kabupaten-merauke'];
    expect(d.t).toBe('terukur');
    expect(d.s).toBe(2);
    expect(d.v[0]).toBe(40); // CAMS 20 scaled to the sensors' 40
    expect(d.v[1]).toBe(42); // the same ratio (2) on the next hour (21)
    expect(t.t).toBe('terkalibrasi');
    expect(t.f).toBe(2); // median sensor/CAMS ratio around it (sensors sit nearest Denpasar's CAMS 20)
    expect(m.t).toBe('indikatif');
    expect(m.v[0]).toBe(10);
    expect(f.jumlah).toEqual({ terukur: 1, terkalibrasi: 1, indikatif: 1 });
  });
  it('keeps the scale within 0.25-4', () => {
    const f = latarFile([centres[0]], camsSeries([ans(1)]), [{ lon: 115.22, lat: -8.66, pm25: 500 }], now);
    expect(f.wilayah['kota-denpasar'].f).toBe(4);
  });
});
