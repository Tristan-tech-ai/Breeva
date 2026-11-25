/**
 * N-36: grid arithmetic for Open-Meteo's open data on AWS (s3://openmeteo, read 25 Nov 2026). Global grids: row 0 at the
 * southern edge of the BBOX in meta.json crs_wkt going north, column 0 at its western edge going east, evenly spaced
 * between the BBOX edges (cams_global 0.4 degree: BBOX[-90,-180,90,179.6]; ncep_gfs013 is a Gaussian grid,
 * BBOX[-89.912125,-180,89.912125,179.88281], whose rows are evenly spaced to well under 0.01 degree in the tropics);
 * files hold [ny, nx, time] in chunks of chunk_time_length time steps, file chunk_<k>.om holds
 * steps k*L .. k*L+L-1 counted from 1970 in steps of temporal_resolution_seconds. Pure; the Lambda does the reading.
 */
export interface OmMeta { crs_wkt?: string; chunk_time_length: number; temporal_resolution_seconds: number; last_run_initialisation_time: number; last_run_availability_time: number; data_end_time: number; update_interval_seconds: number }

/** A box of a global grid, rows south to north, values [y][x][t] flattened. */
export interface OmBox { lat0: number; lon0: number; dlat: number; dlon: number; ny: number; nx: number; times: number[]; data: Float32Array }

/** [latMin, lonMin, latMax, lonMax] from the crs_wkt BBOX of meta.json; null when it has none. */
export function bboxOf(m: Pick<OmMeta, 'crs_wkt'>): [number, number, number, number] | null {
  const hit = /BBOX\[([^\]]+)\]/.exec(m.crs_wkt ?? '');
  const v = hit?.[1].split(',').map(Number);
  return v && v.length === 4 && v.every(Number.isFinite) ? [v[0], v[1], v[2], v[3]] : null;
}

/** Origin and steps of a grid of ny rows and nx columns spanning the BBOX (whole globe when there is none). */
export function gridOf(ny: number, nx: number, bbox: [number, number, number, number] | null = null) {
  const [la0, lo0, la1, lo1] = bbox ?? [-90, -180, 90, 180 - 360 / nx];
  return { lat0: la0, lon0: lo0, dlat: (la1 - la0) / (ny - 1), dlon: (lo1 - lo0) / (nx - 1) };
}

/** Row and column ranges (end exclusive) covering the box [W, S, E, N] with one cell of margin. */
export function boxRanges(ny: number, nx: number, box: readonly [number, number, number, number], bbox: [number, number, number, number] | null = null) {
  const g = gridOf(ny, nx, bbox);
  const [w, s, e, n] = box;
  const r0 = Math.max(0, Math.floor((s - g.lat0) / g.dlat) - 1), r1 = Math.min(ny, Math.ceil((n - g.lat0) / g.dlat) + 2);
  const c0 = Math.max(0, Math.floor((w - g.lon0) / g.dlon) - 1), c1 = Math.min(nx, Math.ceil((e - g.lon0) / g.dlon) + 2);
  return { r0, r1, c0, c1, lat0: g.lat0 + r0 * g.dlat, lon0: g.lon0 + c0 * g.dlon, dlat: g.dlat, dlon: g.dlon };
}

/** Which chunk files and which steps inside them hold the time steps [t0, t0 + n) (t in epoch seconds). */
export function chunkPlan(m: Pick<OmMeta, 'chunk_time_length' | 'temporal_resolution_seconds'>, t0: number, n: number): Array<{ chunk: number; start: number; end: number }> {
  const res = m.temporal_resolution_seconds, L = m.chunk_time_length;
  const s0 = Math.floor(t0 / res);
  const out: Array<{ chunk: number; start: number; end: number }> = [];
  for (let s = s0; s < s0 + n;) {
    const chunk = Math.floor(s / L), start = s - chunk * L, end = Math.min(L, start + (s0 + n - s));
    out.push({ chunk, start, end });
    s += end - start;
  }
  return out;
}

/** Join reads of consecutive chunks (each [y][x][t]) into one box along time. */
export function joinTime(parts: Float32Array[], ny: number, nx: number, nts: number[]): Float32Array {
  const nt = nts.reduce((a, b) => a + b, 0);
  const out = new Float32Array(ny * nx * nt);
  for (let p = 0, off = 0; p < parts.length; off += nts[p], p++) {
    for (let i = 0; i < ny * nx; i++) out.set(parts[p].subarray(i * nts[p], (i + 1) * nts[p]), i * nt + off);
  }
  return out;
}

/** Value of the grid cell nearest to (lon, lat) at time index t, as the Open-Meteo API answers (ties go north/east). */
export function nearest(b: OmBox, lon: number, lat: number, t: number): number {
  const nt = b.times.length;
  const y = Math.round((lat - b.lat0) / b.dlat), x = Math.round((lon - b.lon0) / b.dlon);
  if (y < 0 || x < 0 || y >= b.ny || x >= b.nx || t < 0 || t >= nt) return Number.NaN;
  return b.data[(y * b.nx + x) * nt + t];
}

/** Bilinear value at (lon, lat) and time index t; NaN outside the box or where a corner is missing. */
export function sample(b: OmBox, lon: number, lat: number, t: number): number {
  const nt = b.times.length;
  const fy = (lat - b.lat0) / b.dlat, fx = (lon - b.lon0) / b.dlon;
  const y = Math.floor(fy), x = Math.floor(fx);
  if (y < 0 || x < 0 || y + 1 >= b.ny || x + 1 >= b.nx || t < 0 || t >= nt) return Number.NaN;
  const v = (yy: number, xx: number) => b.data[(yy * b.nx + xx) * nt + t];
  const ty = fy - y, tx = fx - x;
  return (v(y, x) * (1 - tx) + v(y, x + 1) * tx) * (1 - ty) + (v(y + 1, x) * (1 - tx) + v(y + 1, x + 1) * tx) * ty;
}
