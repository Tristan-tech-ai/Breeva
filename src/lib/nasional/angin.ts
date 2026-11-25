/**
 * N-10: national 10 m wind grid (1.5 degree over Indonesia, 24 hours ahead) from the Open-Meteo forecast API with many
 * locations per request. Free use is non-commercial, under 10,000 calls a day (open-meteo.com/en/terms, read 25 Nov 2026);
 * 384 points every 3 hours = 3,072 calls a day.
 */
import { sample, type OmBox } from './omgrid';
export interface WindGrid { lon0: number; lat0: number; step: number; nx: number; ny: number }
export const GRID: WindGrid = { lon0: 95, lat0: -11, step: 1.5, nx: 32, ny: 12 };
/** N-36: the fine grid the smoke paths follow (the ECMWF IFS 0.25 degree points over Indonesia); never published */
export const FINE_GRID: WindGrid = { lon0: 94.5, lat0: -11.5, step: 0.25, nx: 189, ny: 73 };
export const CHUNK = 100;

export interface WindFile {
  format: 'angin';
  updated_at: string;
  sumber: string;
  grid: WindGrid;
  /** N-36: model run the values come from (UTC ISO), when read from s3://openmeteo */
  run?: string;
  /** ISO hours (UTC) of the columns */
  hours: string[];
  /** per grid point (row-major from the south-west), per hour: speed m/s (1 decimal) */
  speed: number[][];
  /** per grid point, per hour: direction the wind comes FROM, degrees */
  dir: number[][];
}

export function gridPoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let j = 0; j < GRID.ny; j++) for (let i = 0; i < GRID.nx; i++) pts.push([GRID.lon0 + i * GRID.step, GRID.lat0 + j * GRID.step]);
  return pts;
}

export function windUrl(pts: Array<[number, number]>): string {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map((p) => p[1]).join(',') + '&longitude=' + pts.map((p) => p[0]).join(',')
    + '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&forecast_hours=24&timezone=GMT';
}

interface OmLoc { hourly?: { time?: string[]; wind_speed_10m?: (number | null)[]; wind_direction_10m?: (number | null)[] } }

/** Join the chunked answers (each an array of locations, or one object for a single location) into one file. */
export function windFile(answers: Array<OmLoc | OmLoc[]>, now: Date): WindFile {
  const locs = answers.flatMap((a) => (Array.isArray(a) ? a : [a]));
  const hours = (locs[0]?.hourly?.time ?? []).map((t) => `${t}:00Z`.replace(':00:00Z', ':00Z'));
  return {
    format: 'angin', updated_at: now.toISOString(), sumber: 'Open-Meteo (prakiraan angin 10 m)', grid: GRID, hours,
    speed: locs.map((l) => (l.hourly?.wind_speed_10m ?? []).map((v) => (v == null ? -1 : Math.round(v * 10) / 10))),
    dir: locs.map((l) => (l.hourly?.wind_direction_10m ?? []).map((v) => (v == null ? -1 : Math.round(v)))),
  };
}

/** Wind at a point and hour index by bilinear interpolation of u/v (null outside the grid or without data). */
export function windAt(f: WindFile, lon: number, lat: number, h: number): { speed: number; from: number } | null {
  const x = (lon - f.grid.lon0) / f.grid.step, y = (lat - f.grid.lat0) / f.grid.step;
  if (x < 0 || y < 0 || x > f.grid.nx - 1 || y > f.grid.ny - 1) return null;
  const i = Math.min(f.grid.nx - 2, Math.floor(x)), j = Math.min(f.grid.ny - 2, Math.floor(y));
  const fx = x - i, fy = y - j;
  let u = 0, v = 0, w = 0;
  for (const [di, dj, ww] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
    const k = (j + dj) * f.grid.nx + (i + di);
    const s = f.speed[k]?.[h], d = f.dir[k]?.[h];
    if (s == null || d == null || s < 0 || d < 0) continue;
    const rad = (d * Math.PI) / 180; // meteorological: direction the wind comes from
    u += -s * Math.sin(rad) * ww; v += -s * Math.cos(rad) * ww; w += ww;
  }
  if (w === 0) return null;
  u /= w; v /= w;
  const speed = Math.hypot(u, v);
  const from = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  return { speed: Math.round(speed * 10) / 10, from: Math.round(from) };
}

/**
 * N-36: a wind file on `grid` from u/v boxes read from s3://openmeteo (m/s, [y][x][t]): hourly, with u and v
 * interpolated linearly in time when the model step is longer (ECMWF IFS 0.25 is 3-hourly); speed rounded to 0.1 m/s
 * and the direction the wind comes FROM, as windFile gives from the API.
 */
export function windFromBoxes(u: OmBox, v: OmBox, grid: WindGrid, now: Date, run?: string): WindFile {
  const t0 = u.times[0], t1 = u.times[u.times.length - 1];
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += 3600) hours.push(t);
  // time index and weight of each hour between two model steps
  const at = hours.map((t) => {
    let k = 0;
    while (k + 1 < u.times.length - 1 && u.times[k + 1] <= t) k++;
    const span = (u.times[k + 1] ?? u.times[k]) - u.times[k];
    return { k, w: span > 0 ? (t - u.times[k]) / span : 0 };
  });
  const speed: number[][] = [], dir: number[][] = [];
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const lon = grid.lon0 + i * grid.step, lat = grid.lat0 + j * grid.step;
    const us = u.times.map((_, t) => sample(u, lon, lat, t)), vs = v.times.map((_, t) => sample(v, lon, lat, t));
    const sp: number[] = [], dr: number[] = [];
    for (const { k, w } of at) {
      const uu = us[k] * (1 - w) + (w > 0 ? us[k + 1] * w : 0), vv = vs[k] * (1 - w) + (w > 0 ? vs[k + 1] * w : 0);
      if (!Number.isFinite(uu) || !Number.isFinite(vv)) { sp.push(-1); dr.push(-1); continue; }
      sp.push(Math.round(Math.hypot(uu, vv) * 10) / 10);
      dr.push(Math.round((Math.atan2(-uu, -vv) * 180 / Math.PI + 360) % 360));
    }
    speed.push(sp); dir.push(dr);
  }
  return {
    format: 'angin', updated_at: now.toISOString(), sumber: 'ECMWF IFS 0,25 derajat lewat data terbuka Open-Meteo di AWS (angin 10 m)', grid,
    hours: hours.map((t) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z'), speed, dir, ...(run ? { run } : {}),
  };
}
