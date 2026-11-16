/** Data and helpers of the public /validasi page (public/data/validasi.json, built by scripts/field/build-validation-page.mts). */

export interface EpaRow {
  id: string; label: string; source: string;
  nrmse_pct: number; r2: number; slope: number | null; intercept: number | null; n: number | null;
  flags: { nrmse: boolean; r2: boolean; slope: boolean; intercept: boolean };
  passed: number;
}

export interface Validasi {
  built_at: string;
  standard: { name: string; nrmse_pct: number; r2: number; slope: [number, number]; intercept: number };
  rule: string;
  daily: EpaRow[];
  hourly: { nrmse_pct: number; rmse: number; source: string; pi95_coverage_before: number; pi95_coverage_calibrated: number; pi95_median_width: number };
  city_hourly_rmse: { global_model: number; calibrated_with_visibility: number; source: string };
  time_split_calibration: { loco_sep_oct: number; time_and_loco: number; without_palembang: number; cams_without_palembang: number; source: string };
  rejected: Array<{ name: string; before: number | null; after: number | null; unit: string; source: string }>;
}

/** Recompute the four EPA checks from the numbers, so the page never shows a flag its numbers do not support. */
export function epaFlags(r: Pick<EpaRow, 'nrmse_pct' | 'r2' | 'slope' | 'intercept'>, s: Validasi['standard']) {
  const flags = {
    nrmse: r.nrmse_pct <= s.nrmse_pct,
    r2: r.r2 >= s.r2,
    slope: r.slope != null && r.slope >= s.slope[0] && r.slope <= s.slope[1],
    intercept: r.intercept != null && Math.abs(r.intercept) <= s.intercept,
  };
  return { flags, passed: Object.values(flags).filter(Boolean).length };
}

/** "akurat" only when all four pass; otherwise how many. */
export function verdict(passed: number): string {
  return passed === 4 ? 'lolos 4 dari 4: akurat menurut target EPA' : passed === 0 ? 'belum lolos: indikatif' : `lolos ${passed} dari 4`;
}

export const pct = (x: number) => `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
export const num = (x: number | null, d = 2) => (x == null ? '–' : x.toLocaleString('id-ID', { maximumFractionDigits: d }));
