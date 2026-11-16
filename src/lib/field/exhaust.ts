/**
 * Vehicle exhaust near roads ("asap kendaraan"): the traffic part of the field, as an inert tracer (NOx) and primary
 * PM2.5, at a receptor from the road lines around it. Pure functions, no I/O: used by the field builder and testable.
 *
 * Why this replaces the hourly single-direction plume for the field (decision 16 Nov 2026):
 *  - the wind direction comes from a ~10 km weather model; at street level it is channelled and unknown, and a single
 *    direction made a road's value swing between "nothing" (cross wind) and "everything" (wind along the road);
 *  - the old sum took the 40 nearest road pieces by midpoint, so a trunk road 150 m away was often dropped;
 *  - rural dispersion curves were used inside cities.
 *
 * Formulation (every number is from the primary source named beside it):
 *  - random-plume limit of AERMOD (EPA-454/B-26-003, section 5.4, eq. 70): wind direction uniform over 2 pi, so a
 *    source element of strength q dl at radial distance r gives  q dl V(r) / (2 pi r u);
 *  - V(r) is the usual vertical term with ground reflection and sigma_z^2 = SGZ1^2 + sigma_zU(r - W2)^2;
 *  - SGZ1 = 1.8 + 0.11 TR, TR = W2 / u, adjusted to the averaging time by (ATIM/30)^0.2; W2 = half the mixing zone,
 *    the travelled way plus 3 m on either side (CALINE-3 user's guide, section 5.2);
 *  - sigma_zU: Briggs' urban formulas fitted to McElroy-Pooler (ISC3 user's guide vol. II, EPA-454/B-95-003b,
 *    table 1-4); classes E and F share one formula in the urban tables;
 *  - a receptor inside the mixing zone sees the zone as uniform (r is not allowed below W2).
 * Not modelled: which side is downwind, buildings as barriers, NO to NO2 chemistry (the tracer is NOx as NO2 mass).
 */

export type Stability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Fleet-average emission factors in g/km per vehicle (the service engine's FLEET_EMISSION). */
export const EMISSION_G_PER_KM = { nox: 1.2, pm25: 0.08 } as const;

export const RECEPTOR_HEIGHT_M = 1.5;
export const SOURCE_HEIGHT_M = 0.5;
export const MIN_WIND_MS = 0.5;
export const CUTOFF_M = 500;
/** Minor roads counted per receptor (nearest by midpoint); every major road within the cut-off is counted. */
export const MINOR_CAP = 40;
const AVERAGING_MIN = 60;
const MAJOR_CLASSES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
]);

export const isMajor = (highway: string) => MAJOR_CLASSES.has(highway);

/** Briggs urban sigma_z in metres, x in metres (ISC3 vol. II table 1-4). */
export function urbanSigmaZ(x: number, s: Stability): number {
  if (x <= 0) return 0;
  if (s === 'A' || s === 'B') return 0.24 * x * Math.sqrt(1 + 0.001 * x);
  if (s === 'C') return 0.2 * x;
  if (s === 'D') return (0.14 * x) / Math.sqrt(1 + 0.0003 * x);
  return (0.08 * x) / Math.sqrt(1 + 0.0015 * x);
}

/** Half width of the mixing zone: half the travelled way plus 3 m (CALINE-3 section 5.2). */
export function mixingHalfWidth(carriagewayM: number | null | undefined): number {
  const w = carriagewayM != null && carriagewayM > 0 ? carriagewayM : 4;
  return w / 2 + 3;
}

/** Initial vertical dispersion over the road, metres (CALINE-3 section 5.2), for hourly averages. */
export function initialSigmaZ(halfW: number, windMs: number): number {
  const tr = halfW / Math.max(windMs, MIN_WIND_MS);
  return (1.8 + 0.11 * tr) * Math.pow(AVERAGING_MIN / 30, 0.2);
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Vertical term at receptor height for a ground-level release with reflection, 1/m. */
function vertical(sigmaZ: number): number {
  const a = RECEPTOR_HEIGHT_M - SOURCE_HEIGHT_M, b = RECEPTOR_HEIGHT_M + SOURCE_HEIGHT_M;
  const d = 2 * sigmaZ * sigmaZ;
  return (Math.exp(-(a * a) / d) + Math.exp(-(b * b) / d)) / (SQRT_2PI * sigmaZ);
}

/**
 * Concentration per unit line strength (ug/m3 per ug/m/s) at the origin from a polyline given in metres relative to
 * the receptor (flat array x0,y0,x1,y1,...), direction-averaged. Pieces farther than the cut-off add nothing.
 */
export function lineKernel(xy: ArrayLike<number>, windMs: number, s: Stability, halfW: number, cutoffM = CUTOFF_M): number {
  const u = Math.max(windMs, MIN_WIND_MS);
  const sz0 = initialSigmaZ(halfW, u);
  let sum = 0;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i], ay = xy[i + 1], bx = xy[i + 2], by = xy[i + 3];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    // closest approach of the piece to the receptor sets the step: fine near the receptor, coarse far away
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len)));
    const near = Math.hypot(ax + t * dx, ay + t * dy);
    if (near > cutoffM) continue;
    const step = Math.max(2, Math.min(50, Math.max(near, halfW) / 3));
    const n = Math.ceil(len / step), dl = len / n;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const r = Math.hypot(ax + f * dx, ay + f * dy);
      if (r > cutoffM) continue;
      const sz = Math.hypot(sz0, urbanSigmaZ(r - halfW, s));
      sum += (dl * vertical(sz)) / Math.max(r, halfW);
    }
  }
  return sum / (2 * Math.PI * u);
}

export interface ExhaustSource {
  /** [lon, lat] vertices. */
  coords: number[][];
  /** Vehicles per hour at this hour, after the hour-of-day curve and any live congestion factor. */
  vehPerHour: number;
  /** Multiplier on the concentration (road-class factor, street canyon). */
  mod: number;
  halfW: number;
  major: boolean;
}

export interface Met { wind: number; stability: Stability }

const CELL_DEG = 0.0025; // about 275 m
const M_LAT = 110574;
const M_LON_EQ = 111320;

/**
 * Traffic part at each receptor: NOx (as NO2 mass) and primary PM2.5 in ug/m3, from every major road within the
 * cut-off and the nearest minor roads. Sources and receptors are independent lists (a receptor can be a road midpoint
 * or any point such as a school gate).
 */
export function exhaustAt(
  sources: ExhaustSource[],
  receptors: Array<{ lat: number; lon: number }>,
  metAt: (lat: number, lon: number) => Met,
): Array<{ nox: number; pm25: number }> {
  const minors = new Map<string, number[]>(), majors = new Map<string, number[]>();
  const mid: Array<[number, number]> = [];
  const push = (m: Map<string, number[]>, key: string, j: number) => {
    const a = m.get(key);
    if (!a) m.set(key, [j]);
    else if (a[a.length - 1] !== j) a.push(j);
  };
  sources.forEach((s, j) => {
    const c = s.coords, m = c[Math.floor(c.length / 2)];
    mid.push([m[1], m[0]]);
    if (!s.major) { push(minors, `${Math.floor(m[1] / CELL_DEG)}:${Math.floor(m[0] / CELL_DEG)}`, j); return; }
    // a long major road is found from every grid cell it crosses (sampled at least every ~100 m)
    for (let i = 0; i < c.length; i++) {
      push(majors, `${Math.floor(c[i][1] / CELL_DEG)}:${Math.floor(c[i][0] / CELL_DEG)}`, j);
      if (i + 1 < c.length) {
        const steps = Math.ceil(Math.hypot((c[i + 1][0] - c[i][0]) * M_LON_EQ, (c[i + 1][1] - c[i][1]) * M_LAT) / 100);
        for (let q = 1; q < steps; q++) {
          const f = q / steps;
          push(majors, `${Math.floor((c[i][1] + f * (c[i + 1][1] - c[i][1])) / CELL_DEG)}:${Math.floor((c[i][0] + f * (c[i + 1][0] - c[i][0])) / CELL_DEG)}`, j);
        }
      }
    }
  });
  const reach = Math.ceil(CUTOFF_M / (CELL_DEG * M_LAT)); // cells to look at on each side
  return receptors.map((R) => {
    const met = metAt(R.lat, R.lon);
    const mLon = M_LON_EQ * Math.cos((R.lat * Math.PI) / 180);
    const ci = Math.floor(R.lat / CELL_DEG), cj = Math.floor(R.lon / CELL_DEG);
    const near: Array<{ j: number; d: number }> = [];
    const big = new Set<number>();
    for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) {
      const key = `${ci + di}:${cj + dj}`;
      for (const j of majors.get(key) ?? []) big.add(j);
      for (const j of minors.get(key) ?? []) {
        const d = Math.hypot((mid[j][1] - R.lon) * mLon, (mid[j][0] - R.lat) * M_LAT);
        if (d <= CUTOFF_M) near.push({ j, d });
      }
    }
    near.sort((a, b) => a.d - b.d);
    let unit = 0; // sum of kernel x vehicles x modifier
    const add = (j: number) => {
      const s = sources[j];
      if (!(s.vehPerHour > 0)) return;
      const xy = new Float64Array(s.coords.length * 2);
      for (let i = 0; i < s.coords.length; i++) { xy[2 * i] = (s.coords[i][0] - R.lon) * mLon; xy[2 * i + 1] = (s.coords[i][1] - R.lat) * M_LAT; }
      unit += lineKernel(xy, met.wind, met.stability, s.halfW) * s.vehPerHour * s.mod;
    };
    for (const j of big) add(j);
    for (let i = 0; i < near.length && i < MINOR_CAP; i++) add(near[i].j);
    // q [ug/m/s] = veh/h x g/km / 3600 / 1000 x 1e6
    const k = 1e6 / 3600 / 1000;
    return { nox: unit * EMISSION_G_PER_KM.nox * k, pm25: unit * EMISSION_G_PER_KM.pm25 * k };
  });
}
