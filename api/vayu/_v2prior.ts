// Shared v2 physical-prior pieces — Background-β (Layer A Berrocal) + GP (Layer D) — PURE (no I/O).
// Underscore module → Vercel inlines it into each importing function bundle (import with .js). Single
// source used by road-aqi.ts (map) AND route-score.ts (route scoring) so the two stay consistent.
// Params from vayu/calibration/layer_a_background_params.json + gp_serving_params.json (LOSO-validated).

// Layer A Background: Background = b0 + b1·CAMS_daily_mean (slope/identity/offset/climatology unified).
export const V2_BACKGROUND: Record<string, { b0: number; b1: number }> = {
  jakarta: { b0: 16.7298, b1: 0.2761 }, bali: { b0: 0, b1: 1 }, yogyakarta: { b0: 10.3966, b1: 0.4322 },
  semarang: { b0: 0, b1: 1 }, palembang: { b0: 7.837, b1: 1 }, solo: { b0: 30.8865, b1: 0 },
  surabaya: { b0: 15.1303, b1: 0.1536 }, bandung: { b0: 23.2303, b1: 0.4172 }, denpasar: { b0: 13.2775, b1: 1 },
  makassar: { b0: 14.0227, b1: -0.1177 }, medan: { b0: 15.2735, b1: 0 }, malang: { b0: 8.8923, b1: 0 },
};

// Per-region hourly predictive sigma (µg/m³) from the validated GATE-1 fusion → 95% PI.
export const V2_SIGMA: Record<string, number> = {
  jakarta: 19.22, bali: 11.73, bandung: 22.27, surabaya: 11.67, semarang: 14.41, yogyakarta: 15.66,
  solo: 15.18, medan: 12.07, palembang: 15.28, makassar: 9.35, malang: 12.86, denpasar: 15.49,
};
export const V2_CALIBRATED_REGIONS = new Set(Object.keys(V2_SIGMA));
export const V2_GP_REGIONS = new Set(['jakarta', 'bali']);  // high-confidence label regions

// Layer D GP static spatial residual surface (bali only — LOSO +18.6%; jakarta opted out).
export const V2_GP_SURFACE: Record<string, { lat0: number; lon0: number; ls: number; yMean: number; yStd: number; X: [number, number][]; alpha: number[] }> = {
  bali: {
    lat0: -8.52403447, lon0: 115.32696174, ls: 7.4229, yMean: 0.620663, yStd: 6.827518,
    X: [[30.20199,15.19668],[10.61912,3.21378],[25.67728,9.25886],[-9.69475,-13.4641],[0.02623,-2.15238],[-11.91857,-19.86634],[26.38186,30.03571],[-17.02236,-22.0358],[-27.24645,28.23778],[-10.29914,-30.56658],[-20.29645,9.74538],[25.50113,-16.53806],[-18.38308,-18.2221],[30.77446,8.15312],[2.3051,11.39293],[-22.20982,-1.90912],[-5.25811,9.66798],[-9.1847,2.00465],[0.02623,-2.15238]],
    alpha: [-0.08476381,-0.41118448,-0.12913173,-0.42554574,2.20885934,-0.01725288,-0.13024847,-0.20294122,-0.31646832,-0.00527193,-0.41072721,-0.24049481,0.02436091,-0.08591366,-0.27931973,-0.58215131,-1.11623076,1.74576009,-0.67419344],
  },
};

/** GP spatial residual μ_GP at (lat,lon): RBF kriging from the exported surface. 0 if no surface. */
export function gpResidual(region: string, lat: number, lon: number): number {
  const s = V2_GP_SURFACE[region];
  if (!s) return 0;
  const x = (lon - s.lon0) * 111.320 * Math.cos((s.lat0 * Math.PI) / 180);
  const y = (lat - s.lat0) * 110.574;
  const inv2ls2 = 1 / (2 * s.ls * s.ls);
  let acc = 0;
  for (let i = 0; i < s.X.length; i++) {
    const dx = x - s.X[i][0], dy = y - s.X[i][1];
    acc += Math.exp(-(dx * dx + dy * dy) * inv2ls2) * s.alpha[i];
  }
  const gp = s.yMean + s.yStd * acc;
  return Number.isFinite(gp) ? gp : 0;
}

/** Calibrated ambient PM2.5 = b0 + b1·CAMS_daily (falls back to current/region default). */
export function backgroundPm25(region: string, camsDaily: number, fallbackPm25: number): number {
  const bg = V2_BACKGROUND[region];
  const cams = Number.isFinite(camsDaily) ? camsDaily : fallbackPm25;
  return bg ? Math.max(0, bg.b0 + bg.b1 * cams) : fallbackPm25;
}
