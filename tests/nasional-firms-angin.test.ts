import { describe, expect, it } from 'vitest';
import { fireFile, firmsUrl, parseFirmsCsv } from '../src/lib/nasional/firms';
import { GRID, gridPoints, windAt, windFile, windUrl } from '../src/lib/nasional/angin';

const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-2.12345,113.98765,340.1,0.39,0.36,2026-11-25,0545,N,VIIRS,n,2.0NRT,295.2,12.34,D
-2.5,114.1,330,0.4,0.4,2026-11-23,0545,N,VIIRS,h,2.0NRT,295,8,D
oops,114.1,330,0.4,0.4,2026-11-25,0600,N,VIIRS,h,2.0NRT,295,8,D
-3.0,104.7,360,0.4,0.4,2026-11-25,1812,N20,VIIRS,l,2.0NRT,300,40.25,N`;

describe('titik api FIRMS (N-09)', () => {
  const now = new Date('2026-11-25T19:00:00Z');
  it('builds the area URL for the Indonesia box', () => {
    expect(firmsUrl('KEY', 'VIIRS_SNPP_NRT')).toBe('https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY/VIIRS_SNPP_NRT/94.5,-11.5,141.5,6.5/2');
  });
  it('keeps points from the last 24 hours and drops bad rows', () => {
    const p = parseFirmsCsv(CSV, now);
    expect(p).toEqual([[113.9877, -2.1234, 12.3, 'n', '2026-11-25T05:45Z', 'N'], [104.7, -3, 40.3, 'l', '2026-11-25T18:12Z', 'N20']]);
  });
  it('an error page or empty answer gives no points', () => {
    expect(parseFirmsCsv('Invalid MAP_KEY.', now)).toEqual([]);
    expect(parseFirmsCsv('', now)).toEqual([]);
  });
  it('the file counts points per satellite and sorts by time', () => {
    const f = fireFile({ A: parseFirmsCsv(CSV, now), B: [] }, now);
    expect(f.n).toBe(2);
    expect(f.per_satelit).toEqual({ A: 2, B: 0 });
    expect(f.points[0][4] < f.points[1][4]).toBe(true);
  });
});

describe('angin nasional (N-10)', () => {
  it('grid has 384 points from the south-west', () => {
    const pts = gridPoints();
    expect(pts).toHaveLength(GRID.nx * GRID.ny);
    expect(pts[0]).toEqual([95, -11]);
    expect(pts[pts.length - 1]).toEqual([95 + 31 * 1.5, -11 + 11 * 1.5]);
  });
  it('URL lists every point once', () => {
    const u = windUrl([[95, -11], [96.5, -11]]);
    expect(u).toContain('latitude=-11,-11&longitude=95,96.5');
    expect(u).toContain('forecast_hours=24');
  });
  it('joins answers and interpolates wind between grid points', () => {
    const loc = (s: number, d: number) => ({ hourly: { time: ['2026-11-25T00:00', '2026-11-25T01:00'], wind_speed_10m: [s, s], wind_direction_10m: [d, d] } });
    const answers = [Array.from({ length: GRID.nx * GRID.ny }, () => loc(4, 90))];
    const f = windFile(answers, new Date('2026-11-25T00:30:00Z'));
    expect(f.hours).toEqual(['2026-11-25T00:00Z', '2026-11-25T01:00Z']);
    const w = windAt(f, 100.2, -5.3, 1)!;
    expect(w.speed).toBeCloseTo(4, 5);
    expect(w.from).toBe(90);
    expect(windAt(f, 80, 0, 0)).toBeNull();
  });
});
