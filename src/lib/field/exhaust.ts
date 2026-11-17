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
/**
 * Lowest wind used, m/s. CALINE-3 user's guide section 8.1.6 lists U >= 1 m/s as the input limit (the Gaussian form
 * neglects along-wind diffusion, which stops being true below it), and ISC3 vol. II section 1.1.3 does not let the
 * wind fall below 1.0 m/s either; both are the sources of the initial mixing and the urban sigma_z used here.
 * (Was 0.5 until 17 Nov 2026: night values on Bogor's toll and trunk roads reached 1,000 ug/m3 NOx at 0.54 m/s.)
 */
export const MIN_WIND_MS = 1.0;
export const CUTOFF_M = 500;
/** Minor roads counted per receptor (nearest by midpoint); every major road within the cut-off is counted. */
export const MINOR_CAP = 40;
const AVERAGING_MIN = 60;
const MAJOR_CLASSES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
]);

export const isMajor = (highway: string) => MAJOR_CLASSES.has(highway);

/**
 * Stability class for the exhaust in a city at night. AERMOD Model Formulation (EPA-454/B-26-003, section 5.10): after
 * sunset the urban surface stays warmer than the countryside and forms a "convective-like" boundary layer; for stable
 * hours AERMOD takes the most neutral Monin-Obukhov length of the urban and rural ones ("stable-to-neutral") and
 * computes the vertical spread with N = 0, i.e. neutral. Both field regions are urban cores (Kota Bogor; Denpasar, Kuta,
 * Jimbaran and Canggu south of 8.55 S), so at night the stable classes E and F become the neutral class D; day classes
 * are unchanged. (Added 17 Nov 2026, task F5-19.)
 */
export function urbanStability(s: Stability, hourLocal: number): Stability {
  const night = hourLocal < 6 || hourLocal > 18;
  return night && (s === 'E' || s === 'F') ? 'D' : s;
}

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

/** Road classes whose two directions OpenStreetMap often maps as two separate one-way lines (a dual carriageway). */
const SPLIT_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const TWIN_MAX_M = 50;
const TWIN_COS = -0.8; // directions at least ~143 degrees apart

/**
 * Share of a road class's traffic that one line carries: 0.5 for one half of a dual carriageway, otherwise 1.
 *
 * The traffic estimate is per road class, so without this both one-way halves of a split road each got the whole
 * road's volume and the corridor counted twice. OSM draws each half in its driving direction, so a half is found by
 * geometry alone: a line of the same class running the opposite way within 50 m of points at 20, 50 and 80 % of its
 * length (two of three needed; one for lines under 40 m), measured perpendicular to the other line so that the next
 * piece of the same road, which meets it end to end, is never taken for its twin. A real one-way street with no twin
 * keeps its full volume. Limitation: two separate two-way roads of the same class drawn in opposite directions within
 * 50 m of each other would also be halved (no one-way tag in the pack to tell them apart).
 */
export function splitCarriagewayShare(coords: number[][][], highway: string[]): Float64Array {
  const share = new Float64Array(coords.length).fill(1);
  const cell = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
  const grid = new Map<string, number[]>();
  const cand: number[] = [];
  coords.forEach((c, k) => {
    if (!SPLIT_CLASSES.has(highway[k]) || c.length < 2) return;
    cand.push(k);
    const seen = new Set<string>();
    for (let i = 0; i < c.length; i++) {
      const steps = i + 1 < c.length ? Math.max(1, Math.ceil(Math.hypot((c[i + 1][0] - c[i][0]) * M_LON_EQ, (c[i + 1][1] - c[i][1]) * M_LAT) / 100)) : 1;
      for (let q = 0; q < steps; q++) {
        const f = q / steps, lat = c[i][1] + (i + 1 < c.length ? f * (c[i + 1][1] - c[i][1]) : 0), lon = c[i][0] + (i + 1 < c.length ? f * (c[i + 1][0] - c[i][0]) : 0);
        const key = cell(lat, lon);
        if (seen.has(key)) continue;
        seen.add(key);
        const a = grid.get(key);
        if (a) a.push(k); else grid.set(key, [k]);
      }
    }
  });
  for (const k of cand) {
    const c = coords[k];
    const mLon = M_LON_EQ * Math.cos((c[0][1] * Math.PI) / 180);
    const segLen: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < c.length; i++) { const l = Math.hypot((c[i + 1][0] - c[i][0]) * mLon, (c[i + 1][1] - c[i][1]) * M_LAT); segLen.push(l); total += l; }
    if (total < 1) continue;
    const fracs = total < 40 ? [0.5] : [0.2, 0.5, 0.8];
    let hits = 0;
    for (const f of fracs) {
      // point at fraction f of the length, and the unit direction of its piece
      let want = f * total, i = 0;
      while (i < segLen.length - 1 && want > segLen[i]) { want -= segLen[i]; i++; }
      const t = segLen[i] > 0 ? want / segLen[i] : 0;
      const lon = c[i][0] + t * (c[i + 1][0] - c[i][0]), lat = c[i][1] + t * (c[i + 1][1] - c[i][1]);
      const dx = ((c[i + 1][0] - c[i][0]) * mLon) / (segLen[i] || 1), dy = ((c[i + 1][1] - c[i][1]) * M_LAT) / (segLen[i] || 1);
      const ci = Math.floor(lat / CELL_DEG), cj = Math.floor(lon / CELL_DEG);
      let hit = false;
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) {
        for (const j of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          if (j === k || highway[j] !== highway[k]) continue;
          const b = coords[j];
          for (let s = 0; s + 1 < b.length; s++) {
            const ax = (b[s][0] - lon) * mLon, ay = (b[s][1] - lat) * M_LAT, bx = (b[s + 1][0] - lon) * mLon, by = (b[s + 1][1] - lat) * M_LAT;
            const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey);
            if (el < 0.5) continue;
            const u = -(ax * ex + ay * ey) / (el * el);
            // the perpendicular foot must fall on the other line, not beyond either of its two ends
            if (u < 0 || u > 1 || (s === 0 && u <= 0) || (s === b.length - 2 && u >= 1)) continue;
            if (Math.hypot(ax + u * ex, ay + u * ey) > TWIN_MAX_M) continue;
            if ((dx * ex + dy * ey) / el <= TWIN_COS) { hit = true; break; }
          }
          if (hit) break;
        }
      }
      if (hit) hits++;
    }
    if (hits >= (fracs.length === 1 ? 1 : 2)) share[k] = 0.5;
  }
  return share;
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

/**
 * Exhaust (NOx, ug/m3) at the given distances from the centre line of a long straight road: the worked example shown
 * to users, computed by the same kernel as the map.
 */
export function straightRoadProfile(vehPerHour: number, windMs: number, s: Stability, carriagewayM: number, distancesM: number[]): number[] {
  const halfW = mixingHalfWidth(carriagewayM);
  const q = (vehPerHour * EMISSION_G_PER_KM.nox * 1e6) / 3600 / 1000;
  return distancesM.map((d) => {
    const xy = new Float64Array(202);
    for (let i = 0; i <= 100; i++) { xy[2 * i] = -d; xy[2 * i + 1] = -2000 + i * 40; }
    return lineKernel(xy, windMs, s, halfW) * q;
  });
}
