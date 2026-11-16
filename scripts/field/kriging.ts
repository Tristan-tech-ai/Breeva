/**
 * Ordinary kriging of citizen-sensor PM2.5 in log space (log1p), exponential covariance with a nugget.
 *
 * Port of the hidden-sensor analysis of the proposal (sumber_proposal/analisis_h.py: pair_stats, fit_vario, ok_predict,
 * estimator "ok_log"). tests/field-kriging.test.ts checks this file against values computed by that Python code, and
 * scripts/field/validate-sensors.mts repeats the whole leave-one-sensor-out test with it.
 */

export interface Variogram { nugget: number; sill: number; range_km: number }

const R_KM = 6371.0088;

/**
 * Distance in km on a local equirectangular plane. The analysis used UTM zone 50S; inside one region (< 100 km) the two
 * differ by well under one percent, far below the spread of the variogram fit.
 */
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const k = Math.PI / 180;
  const x = (lon2 - lon1) * k * Math.cos(((lat1 + lat2) / 2) * k);
  const y = (lat2 - lat1) * k;
  return R_KM * Math.hypot(x, y);
}

export function distanceMatrix(pts: Array<{ lat: number; lon: number }>): number[][] {
  return pts.map((a) => pts.map((b) => distKm(a.lat, a.lon, b.lat, b.lon)));
}

/**
 * Empirical semivariance of every sensor pair: half the mean squared difference over the hours both report.
 * cols[s][t] is sensor s at hour t (NaN when missing). Pairs with fewer than minCommon shared hours stay NaN, weight 0.
 */
export function pairStats(cols: ArrayLike<number>[], minCommon = 300): { G: number[][]; W: number[][] } {
  const n = cols.length;
  const G = Array.from({ length: n }, () => new Array<number>(n).fill(Number.NaN));
  const W = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = cols[i], b = cols[j];
      let s = 0, m = 0;
      for (let t = 0; t < a.length; t++) {
        const x = a[t], y = b[t];
        if (Number.isFinite(x) && Number.isFinite(y)) { const d = x - y; s += d * d; m++; }
      }
      if (m >= minCommon) { G[i][j] = G[j][i] = 0.5 * (s / m); W[i][j] = W[j][i] = m; }
    }
  }
  return { G, W };
}

/** Non-negative least squares with two unknowns, exact (the optimum of a convex QP lies inside or on one face). */
function nnls2(a1: number[], a2: number[], b: number[]): [number, number, number] {
  let s11 = 0, s12 = 0, s22 = 0, s1b = 0, s2b = 0;
  for (let k = 0; k < b.length; k++) {
    s11 += a1[k] * a1[k]; s12 += a1[k] * a2[k]; s22 += a2[k] * a2[k]; s1b += a1[k] * b[k]; s2b += a2[k] * b[k];
  }
  const res = (x1: number, x2: number) => {
    let r = 0;
    for (let k = 0; k < b.length; k++) { const e = a1[k] * x1 + a2[k] * x2 - b[k]; r += e * e; }
    return Math.sqrt(r);
  };
  const det = s11 * s22 - s12 * s12;
  if (det > 0) {
    const x1 = (s22 * s1b - s12 * s2b) / det;
    const x2 = (s11 * s2b - s12 * s1b) / det;
    if (x1 >= 0 && x2 >= 0) return [x1, x2, res(x1, x2)];
  }
  const cands: Array<[number, number]> = [[0, 0]];
  if (s11 > 0) cands.push([Math.max(0, s1b / s11), 0]);
  if (s22 > 0) cands.push([0, Math.max(0, s2b / s22)]);
  let best: [number, number, number] = [0, 0, Infinity];
  for (const [x1, x2] of cands) { const r = res(x1, x2); if (r < best[2]) best = [x1, x2, r]; }
  return best;
}

/**
 * Weighted fit of gamma(d) = nugget + sill * (1 - exp(-d / range)) to the pair semivariances (weights sqrt(shared hours)),
 * range searched over 40 log-spaced values from 10^-0.5 to 10^1.9 km. skip leaves one sensor out of the fit.
 */
export function fitVariogram(G: number[][], W: number[][], D: number[][], skip?: number): Variogram {
  const d: number[] = [], g: number[] = [], w: number[] = [];
  for (let i = 0; i < G.length; i++) {
    for (let j = i + 1; j < G.length; j++) {
      if (!Number.isFinite(G[i][j]) || i === skip || j === skip) continue;
      d.push(D[i][j]); g.push(G[i][j]); w.push(Math.sqrt(W[i][j]));
    }
  }
  if (!d.length) throw new Error('no sensor pair with enough shared hours to fit a variogram');
  let best: { r: number; v: Variogram } | null = null;
  const b = g.map((x, k) => x * w[k]);
  for (let k = 0; k < 40; k++) {
    const L = 10 ** (-0.5 + (k * 2.4) / 39);
    const a2 = d.map((x, q) => (1 - Math.exp(-x / L)) * w[q]);
    const [c0, c1, r] = nnls2(w, a2, b);
    if (best === null || r < best.r) best = { r, v: { nugget: c0, sill: c1, range_km: L } };
  }
  return best!.v;
}

/** LU decomposition with partial pivoting; null when singular. */
function lu(A: number[][]): { LU: number[][]; piv: number[] } | null {
  const n = A.length;
  const M = A.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let p = k, mx = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > mx) { mx = Math.abs(M[i][k]); p = i; }
    if (!(mx > 1e-12)) return null;
    if (p !== k) { [M[p], M[k]] = [M[k], M[p]]; [piv[p], piv[k]] = [piv[k], piv[p]]; }
    for (let i = k + 1; i < n; i++) {
      const f = (M[i][k] /= M[k][k]);
      if (f !== 0) for (let j = k + 1; j < n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return { LU: M, piv };
}

function luSolve(f: { LU: number[][]; piv: number[] }, b: number[]): number[] {
  const n = b.length;
  const x = f.piv.map((p) => b[p]);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= f.LU[i][j] * x[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= f.LU[i][j] * x[j];
    x[i] /= f.LU[i][i];
  }
  return x;
}

/**
 * Ordinary kriging system for a fixed set of sensors. Covariance C(d) = sill * exp(-d / range), plus the nugget on the
 * diagonal, so the estimate predicts what a sensor at the target would read (measurement noise included).
 */
export class OrdinaryKriging {
  private f: { LU: number[][]; piv: number[] } | null;
  private readonly k: number;

  constructor(private readonly pts: Array<{ lat: number; lon: number }>, private readonly v: Variogram, D?: number[][]) {
    this.k = pts.length;
    if (!this.k) throw new Error('kriging needs at least one sensor');
    const DD = D ?? distanceMatrix(pts);
    const S = Array.from({ length: this.k + 1 }, () => new Array<number>(this.k + 1).fill(0));
    for (let i = 0; i < this.k; i++) {
      for (let j = 0; j < this.k; j++) S[i][j] = v.sill * Math.exp(-DD[i][j] / v.range_km) + (i === j ? v.nugget : 0);
      S[i][this.k] = 1; S[this.k][i] = 1;
    }
    this.f = lu(S);
  }

  /** Weights and kriging variance for a target given its distance (km) to each sensor. Singular system: equal weights. */
  weightsFor(dist: number[]): { w: number[]; variance: number } {
    const { sill, nugget, range_km } = this.v;
    const c = dist.map((d) => sill * Math.exp(-d / range_km));
    if (!this.f) return { w: new Array<number>(this.k).fill(1 / this.k), variance: Number.NaN };
    const sol = luSolve(this.f, [...c, 1]);
    const w = sol.slice(0, this.k);
    let wc = 0;
    for (let i = 0; i < this.k; i++) wc += w[i] * c[i];
    return { w, variance: Math.max(0, sill + nugget - wc - sol[this.k]) };
  }

  /** Estimate in the space of the values given (the caller passes log1p of PM2.5). */
  predict(values: number[], lat: number, lon: number): { mean: number; variance: number; nearest_km: number } {
    const dist = this.pts.map((p) => distKm(lat, lon, p.lat, p.lon));
    const { w, variance } = this.weightsFor(dist);
    let mean = 0;
    for (let i = 0; i < this.k; i++) mean += w[i] * values[i];
    return { mean, variance, nearest_km: Math.min(...dist) };
  }
}

/**
 * Leave-one-out prediction of sensor `target` at every hour from the other sensors that report that hour, the way
 * analisis_h.ok_predict does it (one kriging system per pattern of reporting sensors). cols are in log1p space.
 */
export function looPredict(cols: ArrayLike<number>[], D: number[][], target: number, v: Variogram): { mean: Float64Array; variance: Float64Array } {
  const T = cols[0].length;
  const others = cols.map((_, j) => j).filter((j) => j !== target);
  const mean = new Float64Array(T).fill(Number.NaN);
  const variance = new Float64Array(T).fill(Number.NaN);
  const cache = new Map<string, { idx: number[]; w: number[]; variance: number }>();
  for (let t = 0; t < T; t++) {
    const idx = others.filter((j) => Number.isFinite(cols[j][t]));
    if (!idx.length) continue;
    const key = idx.join(',');
    let e = cache.get(key);
    if (!e) {
      const sub = idx.map((a) => idx.map((b) => D[a][b]));
      const ok = new OrdinaryKriging(idx.map(() => ({ lat: 0, lon: 0 })), v, sub);
      const r = ok.weightsFor(idx.map((j) => D[j][target]));
      e = { idx, w: r.w, variance: r.variance };
      cache.set(key, e);
    }
    let m = 0;
    for (let q = 0; q < e.idx.length; q++) m += e.w[q] * cols[e.idx[q]][t];
    mean[t] = m;
    variance[t] = e.variance;
  }
  return { mean, variance };
}
