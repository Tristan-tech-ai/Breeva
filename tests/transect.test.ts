import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoadPack } from '../scripts/field/pack';
import {
  attachPositions, findStops, makeRoadIndex, meanCi, pairStops, parseGpx, parseSensorCsv, parseTime, privacyTrim, roadClass,
  type StopOnRoad,
} from '../scripts/field/transect';

const pack = new RoadPack(new Uint8Array(readFileSync('tests/fixtures/pack_small.bin')));
// pack_small: road 0 is a primary road near (-8.64992, 115.16655), road 1 a service road near (-8.65212, 115.17614)
const P = { lat: -8.64992, lon: 115.16655 }, S = { lat: -8.65212, lon: 115.17614 }, HOME = { lat: -8.640, lon: 115.150 };

function csv(rows: Array<[string, number, number, number]>) {
  return ['Date,VOC,Temperature,Humidity,Pressure,PM1,PM2.5,PM10,Latitude,Longitude', ...rows.map(([t, pm, la, lo]) => `${t},0.1,30,80,1009,${pm - 3},${pm},${pm + 4},${la},${lo}`)].join('\n');
}
const minutes = (h: number, m0: number, n: number, pm: number, p: { lat: number; lon: number }) =>
  Array.from({ length: n }, (_, k) => [`2026-11-20 ${String(h).padStart(2, '0')}:${String(m0 + k).padStart(2, '0')}:00`, pm, p.lat + k * 1e-5, p.lon] as [string, number, number, number]);

describe('walking test against the model', () => {
  it('reads local clock times in the region\'s zone and ISO times as given', () => {
    expect(parseTime('2026-11-20 07:15:00', 8)).toBe(Date.UTC(2026, 10, 19, 23, 15));
    expect(parseTime('20/11/2026 07:15', 8)).toBe(Date.UTC(2026, 10, 19, 23, 15));
    expect(parseTime('2026-11-20T07:15:00+08:00', 0)).toBe(Date.UTC(2026, 10, 19, 23, 15));
    expect(parseTime('kemarin', 8)).toBeNull();
  });

  it('parses an Atmotube-style CSV, keeps home private and finds 3-minute stops on the right roads', () => {
    const rows = [...minutes(7, 0, 3, 30, HOME), ...minutes(7, 10, 4, 28, S), ...minutes(7, 20, 4, 31, P), ...minutes(7, 40, 3, 30, HOME)];
    const samples = parseSensorCsv(csv(rows), 8);
    expect(samples).toHaveLength(14);
    expect(parseSensorCsv(String.fromCharCode(0xfeff) + csv(rows), 8)).toHaveLength(14); // export with a byte-order mark
    expect(samples[0].pm25).toBe(30);
    const kept = privacyTrim(samples);
    expect(kept).toHaveLength(8);
    const stops = findStops(kept);
    expect(stops.map((s) => Math.round(s.pm25))).toEqual([28, 31]);
    const nearest = makeRoadIndex(pack);
    const roads = stops.map((s) => nearest(s.lat, s.lon));
    expect(roads.map((r) => r && pack.highway(r.k))).toEqual(['service', 'primary']);
    expect(roadClass('service')).toBe('kecil');
    expect(roadClass('primary')).toBe('besar');
    expect(nearest(-8.7, 115.3)).toBeNull();
  });

  it('pairs a small-road stop with the next big-road stop and compares the differences', () => {
    const mk = (pm25: number, p: { lat: number; lon: number }, t: number, klass: 'kecil' | 'besar'): StopOnRoad =>
      ({ start: t, end: t + 180_000, n: 4, lat: p.lat, lon: p.lon, pm25, road: { c: 0, i: klass === 'besar' ? 0 : 1, highway: klass === 'besar' ? 'primary' : 'service', klass, distM: 3 } });
    const stops = [mk(28, S, 0, 'kecil'), mk(31, P, 400_000, 'besar')];
    const model = (s: StopOnRoad) => (s.road.klass === 'besar' ? { pm25: 25.5, pm25_delta: 0.7, no2: 20, no2_delta: 10.5 } : { pm25: 24.8, pm25_delta: 0.05, no2: 10, no2_delta: 0.75 });
    expect(pairStops(stops, model)).toHaveLength(0); // about 1 km apart: beyond the 300 m pairing distance
    const pairs = pairStops(stops, model, 2000);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].measured_diff).toBe(3);
    expect(pairs[0].model_diff).toBeCloseTo(0.7, 6);
    expect(pairs[0].model_no2_diff).toBe(10);
    expect(meanCi([1, 2, 3])).toEqual({ n: 3, mean: 2, ci95: [0.87, 3.13] });
  });

  it('takes positions from a phone GPX track for a logger without GPS', () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="-8.65212" lon="115.17614"><time>2026-11-19T23:10:00Z</time></trkpt>
      <trkpt lat="-8.64992" lon="115.16655"><time>2026-11-19T23:20:00Z</time></trkpt></trkseg></trk></gpx>`;
    const s = attachPositions([{ t: Date.UTC(2026, 10, 19, 23, 10, 10), pm25: 20 }, { t: Date.UTC(2026, 10, 19, 23, 15), pm25: 21 }], parseGpx(gpx));
    expect(s[0]).toMatchObject({ lat: -8.65212, lon: 115.17614 });
    expect(s[1].lat).toBeUndefined(); // no track point within 30 s
  });
});
