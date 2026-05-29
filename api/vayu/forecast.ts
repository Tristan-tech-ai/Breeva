import type { VercelRequest, VercelResponse } from '@vercel/node';
// Jakarta 24h-AQI forecast ("AQI besok"). Pure-TS inference of the met-free GRUHead model
// (no onnxruntime native dep). Weights inlined via the underscore module (imported with a .js
// extension so Node ESM under type:module resolves it — the route-score/_caline4 lesson).
import { FORECAST24 as M } from './_forecast24_weights.js';

// ── GRU + MLP forward (matches PyTorch nn.GRU gate order [r,z,n], h0=0) ──
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
    const gi = matVec(Wih, x, bih);   // [3H]
    const gh = matVec(Whh, h, bhh);   // [3H]
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

/** Raw model forward on (seq, cov) → (mu, logsigma). Used for parity vs PyTorch. */
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

/** Forecast pm25 at `target` given the current pm25 (used as pm_lag24 — predict 24h ahead). */
export function forecast24(currentPm25: number, target: Date, lat: number, lon: number): { pm25: number; sigma: number } {
  const seq = [[currentPm25 / M.pm_sd, 1.0]];           // n_lag=1: [pm/scale, presence]
  const { mu, logsigma } = forwardRaw(seq, buildCov(target, lat, lon));
  return { pm25: mu * M.t_sd + M.t_mean, sigma: Math.exp(logsigma) * M.t_sd };
}

function pm25ToAQI(p: number): number {
  const bp = [[0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500]];
  for (const [cl, ch, al, ah] of bp) if (p <= ch) return Math.round((ah - al) / (ch - cl) * (p - cl) + al);
  return 500;
}

// Jakarta bbox (model is Jakarta-trained; honest scope).
const JKT = { s: -6.5, w: 106.5, n: -6.0, e: 107.1 };

async function fetchCurrentPm25(lat: number, lon: number): Promise<number | null> {
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=pm2_5&timezone=auto`);
    if (!r.ok) return null;
    const j = await r.json() as { current?: { pm2_5?: number } };
    const v = j?.current?.pm2_5;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const lat = parseFloat(String(req.query.lat ?? ''));
  const lon = parseFloat(String(req.query.lon ?? ''));
  const hoursAhead = Math.max(1, Math.min(48, parseInt(String(req.query.hours ?? '24'), 10) || 24));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(200).json({ error: 'missing lat/lon', meta: { model: 'jakarta_forecast24' } });
  }
  const inJakarta = lat >= JKT.s && lat <= JKT.n && lon >= JKT.w && lon <= JKT.e;
  const current = await fetchCurrentPm25(lat, lon);
  if (current == null) {
    return res.status(200).json({ error: 'no current pm2.5 available', meta: { model: 'jakarta_forecast24' } });
  }
  const target = new Date(Date.now() + hoursAhead * 3600 * 1000);
  const { pm25, sigma } = forecast24(current, target, lat, lon);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  // pi95 = model's calibrated aleatoric σ (validation PI95 cov 0.945 — wide, covers haze tails, honest).
  // typical = ± held-out 2025 forecast RMSE (23.12, met-free) — the usable "typical day" band (~1σ).
  const FORECAST24_RMSE = 23.12;
  res.setHeader('Cache-Control', 's-maxage=1800');
  return res.status(200).json({
    forecast_pm25: r1(pm25),
    forecast_aqi: pm25ToAQI(pm25),
    typical_lo: r1(Math.max(0, pm25 - FORECAST24_RMSE)),
    typical_hi: r1(Math.min(500, pm25 + FORECAST24_RMSE)),
    pi95_lo: r1(Math.max(0, pm25 - 1.96 * sigma)),
    pi95_hi: r1(Math.min(500, pm25 + 1.96 * sigma)),
    current_pm25: r1(current),
    valid_at: target.toISOString(),
    hours_ahead: hoursAhead,
    confidence: inJakarta ? 'high' : 'low',
    region: inJakarta ? 'jakarta' : 'out_of_scope',
    meta: {
      model: 'jakarta_forecast24 (GRUHead met-free)',
      held_out_2025_rmse: FORECAST24_RMSE,
      note: inJakarta ? 'pi95=calibrated σ (wide, haze tails); typical=±held-out RMSE'
                      : 'model trained on Jakarta; out-of-region forecast is indicative only',
    },
  });
}
