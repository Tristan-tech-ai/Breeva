// Jakarta 24h-AQI forecast inference (pure-TS GRUHead, met-free). Underscore module → inlines
// into any importing function bundle (no new serverless function; Hobby 12-fn quota). Weights via
// _forecast24_weights.js (.js extension required by Node ESM under type:module).
import { FORECAST24 as M } from './_forecast24_weights.js';

const W = M.weights as Record<string, number[][] | number[]>;
const Wih = W['gru.weight_ih_l0'] as number[][];   // [3H, 2]
const Whh = W['gru.weight_hh_l0'] as number[][];   // [3H, H]
const bih = W['gru.bias_ih_l0'] as number[];
const bhh = W['gru.bias_hh_l0'] as number[];
const H = M.hidden;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function matVec(Wm: number[][], x: number[], b: number[]): number[] {
  const out = new Array<number>(Wm.length);
  for (let i = 0; i < Wm.length; i++) {
    let s = b[i]; const Wi = Wm[i];
    for (let j = 0; j < x.length; j++) s += Wi[j] * x[j];
    out[i] = s;
  }
  return out;
}
function gruForward(seq: number[][]): number[] {
  let h = new Array<number>(H).fill(0);
  for (const x of seq) {
    const gi = matVec(Wih, x, bih);
    const gh = matVec(Whh, h, bhh);
    const hn = new Array<number>(H);
    for (let k = 0; k < H; k++) {
      const r = sigmoid(gi[k] + gh[k]);
      const z = sigmoid(gi[H + k] + gh[H + k]);
      const n = Math.tanh(gi[2 * H + k] + r * gh[2 * H + k]);
      hn[k] = (1 - z) * n + z * h[k];
    }
    h = hn;
  }
  return h;
}
const relu = (v: number[]) => v.map((x) => (x > 0 ? x : 0));

/** Raw model forward on (seq, cov) → (mu, logsigma). Parity-checked vs PyTorch (1.3e-7). */
export function forwardRaw(seq: number[][], cov: number[]): { mu: number; logsigma: number } {
  const h = gruForward(seq);
  const x0 = h.concat(cov);
  const l0 = relu(matVec(W['head.0.weight'] as number[][], x0, W['head.0.bias'] as number[]));
  const l3 = relu(matVec(W['head.3.weight'] as number[][], l0, W['head.3.bias'] as number[]));
  const out = matVec(W['head.6.weight'] as number[][], l3, W['head.6.bias'] as number[]);
  return { mu: out[0], logsigma: Math.max(-4, Math.min(4, out[1])) };
}

/** Max |error| over the exported PyTorch reference pairs (parity self-check). */
export function parityMaxErr(): number {
  let mx = 0;
  for (const r of M.refs) {
    const o = forwardRaw(r.seq, r.cov);
    mx = Math.max(mx, Math.abs(o.mu - r.mu), Math.abs(o.logsigma - r.logsigma));
  }
  return mx;
}

/** Calendar/geo cov EXACTLY as trained (assemble_jakarta_historical.py): hour WIB, month/doy UTC, doy/365.25. */
function buildCov(target: Date, lat: number, lon: number): number[] {
  const hl = (target.getUTCHours() + 7) % 24;
  const mo = target.getUTCMonth() + 1;
  const doy = Math.floor((Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
    - Date.UTC(target.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const raw = [
    Math.sin(2 * Math.PI * hl / 24), Math.cos(2 * Math.PI * hl / 24),
    Math.sin(2 * Math.PI * mo / 12), Math.cos(2 * Math.PI * mo / 12),
    Math.sin(2 * Math.PI * doy / 365.25), Math.cos(2 * Math.PI * doy / 365.25),
    lat, lon,
  ];
  return raw.map((v, i) => (v - M.cov_mean[i]) / M.cov_std[i]);
}

/** Forecast pm25 at `target` given current pm25 (used as pm_lag24 → predict 24h ahead). */
export function forecast24(currentPm25: number, target: Date, lat: number, lon: number): { pm25: number; sigma: number } {
  const seq = [[currentPm25 / M.pm_sd, 1.0]];
  const { mu, logsigma } = forwardRaw(seq, buildCov(target, lat, lon));
  return { pm25: mu * M.t_sd + M.t_mean, sigma: Math.exp(logsigma) * M.t_sd };
}
