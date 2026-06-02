// Layer 3 — Exposure dose model (SINGLE SOURCE OF TRUTH, pure, no I/O).
// Used by PaparanPage, RouteCard inline, WalkComplete, LiveExposureTracker so the whole app
// reports ONE consistent dose + cigarette number. Per-segment PM2.5 (Cᵢ) comes from the v2 engine
// (route-score `vayu_score.segments`); this file only does the dose arithmetic.
//
// Composed model (Tristan: "keduanya" = health age×activity AND transport-mode intake):
//   D_µg = Σ_i  Cᵢ · V(age,mode) · α(mode) · IF(mode) · Δtᵢ
//   Δtᵢ  = segment time share × duration   (from fraction_along deltas, else length_m, else equal split)
// Citations: V = US EPA Exposure Factors Handbook 2011 Table 6-2; α (penetration, deeper breathing in
// exercise) = Brunekreef 2015 / Int Panis 2010; IF (cabin/helmet intake) = Breeva ERD 7.3 / exposure.ts;
// cigarette 660 µg = Pope 2009; WHO 24h PM2.5 = 15 µg/m³ = WHO 2021 AQG.

export type AgeBucket = 'child' | 'adult' | 'elderly';
export type ExposureMode =
  | 'walk_slow' | 'walk_fast' | 'jog' | 'cycle'
  | 'motorcycle_open' | 'motorcycle_full'
  | 'car_window_open' | 'car_ac_fresh' | 'car_ac_recirculate' | 'public_transport';

export interface UserExposureProfile {
  age_bucket: AgeBucket;
  mode: ExposureMode;
  health_sensitive: boolean;
}

/** Minimal per-segment input — only PM2.5 is required; fraction_along/length_m refine the time split. */
export interface DoseSegmentInput {
  pm25: number;
  fraction_along?: number;  // 0..1 position along route (from route-score segments)
  length_m?: number;
}

export type RiskLevel = 'low' | 'moderate' | 'high' | 'very_high';

export interface ExposureDoseResult {
  dose_ug: number;
  cigarette_equiv: number;
  who_24h_ratio: number;       // mean route PM2.5 / 15 µg/m³ (concentration ratio, NOT dose-vs-threshold)
  mean_pm25: number;
  peak_pm25: number;
  duration_minutes: number;
  risk_level: RiskLevel;
  recommendation: string;
  breathing_rate_m3min: number;
  penetration: number;
  intake_fraction: number;
}

// ─── Cited constants ─────────────────────────────────────────────────────────
export const CIG_UG = 660;          // µg PM2.5 ≈ 1 cigarette inhaled (Pope 2009)
export const WHO_24H_PM25 = 15;     // WHO 2021 AQG 24h PM2.5 mean (µg/m³)

// Minute ventilation V (m³/min) by age × mode — EPA Exposure Factors Handbook 2011, Table 6-2.
// Vehicle modes ≈ seated/resting ventilation (you're not exercising in a car).
export const BREATHING_RATE: Record<AgeBucket, Record<ExposureMode, number>> = {
  adult: {
    walk_slow: 0.025, walk_fast: 0.035, jog: 0.060, cycle: 0.080,
    motorcycle_open: 0.012, motorcycle_full: 0.012, car_window_open: 0.012,
    car_ac_fresh: 0.012, car_ac_recirculate: 0.012, public_transport: 0.012,
  },
  child: {
    walk_slow: 0.020, walk_fast: 0.028, jog: 0.045, cycle: 0.060,
    motorcycle_open: 0.010, motorcycle_full: 0.010, car_window_open: 0.010,
    car_ac_fresh: 0.010, car_ac_recirculate: 0.010, public_transport: 0.010,
  },
  elderly: {
    walk_slow: 0.020, walk_fast: 0.028, jog: 0.045, cycle: 0.060,
    motorcycle_open: 0.010, motorcycle_full: 0.010, car_window_open: 0.010,
    car_ac_fresh: 0.010, car_ac_recirculate: 0.010, public_transport: 0.010,
  },
};

// Penetration multiplier α (deeper breathing drives particles deeper during exertion).
export const PENETRATION: Record<ExposureMode, number> = {
  walk_slow: 1.0, walk_fast: 1.1, jog: 1.4, cycle: 1.5,
  motorcycle_open: 1.0, motorcycle_full: 1.0, car_window_open: 1.0,
  car_ac_fresh: 1.0, car_ac_recirculate: 1.0, public_transport: 1.0,
};

// Intake fraction IF — how much ambient PM2.5 actually reaches the lungs given the enclosure
// (helmet / cabin / AC recirculate). Pedestrian/cyclist breathe the open air = 1.0.
export const INTAKE_FRACTION: Record<ExposureMode, number> = {
  walk_slow: 1.0, walk_fast: 1.0, jog: 1.0, cycle: 1.0,
  motorcycle_open: 0.85, motorcycle_full: 0.60, car_window_open: 0.80,
  car_ac_fresh: 0.50, car_ac_recirculate: 0.15, public_transport: 0.70,
};

// Typical travel speed (m/s) per mode — used to estimate duration when only distance is known.
export const SPEED_MPS: Record<ExposureMode, number> = {
  walk_slow: 1.4, walk_fast: 1.9, jog: 3.0, cycle: 5.0,
  motorcycle_open: 8.3, motorcycle_full: 8.3, car_window_open: 8.3,
  car_ac_fresh: 8.3, car_ac_recirculate: 8.3, public_transport: 6.0,
};

export const MODE_LABELS: Record<ExposureMode, string> = {
  walk_slow: 'Jalan santai', walk_fast: 'Jalan cepat', jog: 'Lari/jogging', cycle: 'Bersepeda',
  motorcycle_open: 'Motor (helm terbuka)', motorcycle_full: 'Motor (helm full-face)',
  car_window_open: 'Mobil (jendela buka)', car_ac_fresh: 'Mobil (AC fresh)',
  car_ac_recirculate: 'Mobil (AC recirculate)', public_transport: 'Angkutan umum',
};

export const AGE_LABELS: Record<AgeBucket, string> = {
  child: 'Anak (5–12)', adult: 'Dewasa', elderly: 'Lansia (65+)',
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Normalized per-segment time shares (sum=1): fraction_along deltas → length_m → equal split. */
export function segmentTimeWeights(segments: DoseSegmentInput[]): number[] {
  const n = segments.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  // 1) fraction_along deltas (monotonic 0..1) — the route-score path.
  const fracs = segments.map((s) => s.fraction_along);
  if (fracs.every((f) => typeof f === 'number' && Number.isFinite(f))) {
    const f = fracs as number[];
    const w = new Array(n).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const next = i < n - 1 ? f[i + 1] : 1;
      const dt = Math.max(0, next - f[i]);
      w[i] = dt; sum += dt;
    }
    if (sum > 1e-9) return w.map((x) => x / sum);
  }

  // 2) length_m proportional.
  const lens = segments.map((s) => s.length_m);
  if (lens.every((l) => typeof l === 'number' && Number.isFinite(l) && (l as number) > 0)) {
    const l = lens as number[];
    const sum = l.reduce((a, b) => a + b, 0);
    if (sum > 1e-9) return l.map((x) => x / sum);
  }

  // 3) equal split.
  return new Array(n).fill(1 / n);
}

export function riskBand(doseUg: number): RiskLevel {
  if (doseUg < 100) return 'low';
  if (doseUg < 500) return 'moderate';
  if (doseUg < 2000) return 'high';
  return 'very_high';
}

export function riskColor(level: RiskLevel): string {
  switch (level) {
    case 'low': return '#22c55e';
    case 'moderate': return '#eab308';
    case 'high': return '#f97316';
    default: return '#ef4444';
  }
}

export function recommendation(doseUg: number, healthSensitive: boolean): string {
  if (doseUg < 100) {
    return 'Paparan dalam batas aman. Rute ini cocok untuk semua kelompok.';
  }
  if (doseUg < 500) {
    return healthSensitive
      ? 'Paparan ringan. Pertimbangkan masker N95 jika Anda sensitif (asma/jantung/hamil).'
      : 'Paparan normal untuk kondisi urban Indonesia.';
  }
  if (doseUg < 2000) {
    return 'Paparan tinggi. Coba rute "paling bersih", ubah moda (mis. mobil AC recirculate), atau pilih waktu lain.';
  }
  return 'Paparan sangat tinggi. Dianjurkan tunda perjalanan atau gunakan transportasi tertutup ber-AC recirculate.';
}

/** "Setara X batang rokok" — illustrative ONLY (different toxicity profile). Always show the caveat. */
export const CIGARETTE_CAVEAT =
  'Perbandingan rokok bersifat ilustratif, bukan ekuivalensi biologis (profil toksisitas berbeda).';

function zeroResult(profile: UserExposureProfile, durMin: number): ExposureDoseResult {
  return {
    dose_ug: 0, cigarette_equiv: 0, who_24h_ratio: 0, mean_pm25: 0, peak_pm25: 0,
    duration_minutes: r2(durMin), risk_level: 'low',
    recommendation: recommendation(0, profile.health_sensitive),
    breathing_rate_m3min: BREATHING_RATE[profile.age_bucket][profile.mode],
    penetration: PENETRATION[profile.mode], intake_fraction: INTAKE_FRACTION[profile.mode],
  };
}

/** D_µg = Σ Cᵢ·V·α·IF·Δtᵢ (Δtᵢ in MINUTES, V in m³/min). The one calculation the whole app shares. */
export function computeDose(
  segments: DoseSegmentInput[],
  durationSeconds: number,
  profile: UserExposureProfile,
): ExposureDoseResult {
  const durMin = Math.max(0, durationSeconds) / 60;
  const valid = (segments || []).filter((s) => Number.isFinite(s.pm25) && s.pm25 >= 0);
  if (valid.length === 0 || durMin <= 0) return zeroResult(profile, durMin);

  const V = BREATHING_RATE[profile.age_bucket]?.[profile.mode]
    ?? BREATHING_RATE.adult.walk_slow;
  const alpha = PENETRATION[profile.mode] ?? 1.0;
  const intake = INTAKE_FRACTION[profile.mode] ?? 1.0;

  const pm = valid.map((s) => s.pm25);
  const meanPm = pm.reduce((a, b) => a + b, 0) / pm.length;
  const peakPm = Math.max(...pm);

  const weights = segmentTimeWeights(valid);
  let dose = 0;
  for (let i = 0; i < valid.length; i++) {
    dose += valid[i].pm25 * V * alpha * intake * (weights[i] * durMin);
  }

  return {
    dose_ug: r2(dose),
    cigarette_equiv: r3(dose / CIG_UG),
    who_24h_ratio: r2(meanPm / WHO_24H_PM25),
    mean_pm25: r2(meanPm),
    peak_pm25: r2(peakPm),
    duration_minutes: r2(durMin),
    risk_level: riskBand(dose),
    recommendation: recommendation(dose, profile.health_sensitive),
    breathing_rate_m3min: V,
    penetration: alpha,
    intake_fraction: intake,
  };
}

export interface DoseSegmentContribution { fraction_along: number; ug: number; pm25: number; }

/** Per-segment µg contribution (same arithmetic as computeDose) — for the breakdown chart. */
export function doseBreakdown(
  segments: DoseSegmentInput[],
  durationSeconds: number,
  profile: UserExposureProfile,
): DoseSegmentContribution[] {
  const durMin = Math.max(0, durationSeconds) / 60;
  const valid = (segments || []).filter((s) => Number.isFinite(s.pm25) && s.pm25 >= 0);
  if (valid.length === 0 || durMin <= 0) return [];
  const V = BREATHING_RATE[profile.age_bucket]?.[profile.mode] ?? BREATHING_RATE.adult.walk_slow;
  const alpha = PENETRATION[profile.mode] ?? 1.0;
  const intake = INTAKE_FRACTION[profile.mode] ?? 1.0;
  const w = segmentTimeWeights(valid);
  return valid.map((s, i) => ({
    fraction_along: typeof s.fraction_along === 'number' ? s.fraction_along : i / Math.max(1, valid.length - 1),
    ug: r2(s.pm25 * V * alpha * intake * (w[i] * durMin)),
    pm25: s.pm25,
  }));
}

// ─── TRAP (traffic-related air pollution) — the AVOIDABLE traffic exposure breeva routes by ──────
// breeva's cleaner-route value is avoiding TRAFFIC pollution (diesel trucks, 2-stroke motorbikes on
// busy roads), NOT total ambient air — ambient PM2.5 is background-dominated (≈33.6 µg everywhere) and
// spatially flat, so showing it makes every route look identical. NO2 dominates: steep near-road
// gradient + low background = the routable fingerprint (separates road classes ~30×). These constants
// MUST MATCH the server (api/vayu/route-score.ts trapConcentration) and the routing overlay
// (scripts/build_valhalla_aqi_overlay.py weights). Parity guard: scripts/test_trap_parity.mjs.
export const TRAP_W_NO2 = 0.70, TRAP_W_PM25 = 0.20, TRAP_W_PM10 = 0.10;
export const TRAP_K_NO2 = 7.4; // NO2 µg/m³ → PM2.5-equivalent toxicity scale

export interface TrapSegmentInput {
  no2_delta?: number;
  pm25_delta?: number;
  pm10_delta?: number;
  fraction_along?: number;
  length_m?: number;
}

/** Per-segment PM2.5-equivalent TRAFFIC-increment concentration (µg/m³), NO2-dominant. */
export function trapConcentration(s: TrapSegmentInput): number {
  return TRAP_W_NO2 * (Math.max(0, s.no2_delta ?? 0) / TRAP_K_NO2)
       + TRAP_W_PM25 * Math.max(0, s.pm25_delta ?? 0)
       + TRAP_W_PM10 * Math.max(0, s.pm10_delta ?? 0);
}

/**
 * Inhaled dose of the AVOIDABLE traffic increment (µg PM2.5-equivalent) — the headline a cleaner route
 * reduces. Reuses computeDose verbatim, fed trap concentration instead of absolute pm25, so it shares
 * the breathing-zone arithmetic (V·α·IF·Δt). Show the absolute total (computeDose) alongside as honest
 * "incl. unavoidable background" context. mean_pm25/peak_pm25 in the result = mean/peak TRAP increment.
 */
export function computeTrapDose(
  segments: TrapSegmentInput[],
  durationSeconds: number,
  profile: UserExposureProfile,
): ExposureDoseResult {
  const trapSegs: DoseSegmentInput[] = (segments || []).map((s) => ({
    pm25: trapConcentration(s), fraction_along: s.fraction_along, length_m: s.length_m,
  }));
  return computeDose(trapSegs, durationSeconds, profile);
}

/** Per-segment µg of the traffic increment — for the breakdown chart (arterial spikes are the story). */
export function computeTrapDoseBreakdown(
  segments: TrapSegmentInput[],
  durationSeconds: number,
  profile: UserExposureProfile,
): DoseSegmentContribution[] {
  const trapSegs: DoseSegmentInput[] = (segments || []).map((s) => ({
    pm25: trapConcentration(s), fraction_along: s.fraction_along, length_m: s.length_m,
  }));
  return doseBreakdown(trapSegs, durationSeconds, profile);
}

/** Convenience: estimate duration (s) from total distance (m) for a planned route lacking a time. */
export function estimateDurationSeconds(distanceMeters: number, mode: ExposureMode): number {
  const v = SPEED_MPS[mode] ?? SPEED_MPS.walk_slow;
  return v > 0 ? distanceMeters / v : 0;
}
