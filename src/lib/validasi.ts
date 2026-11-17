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
  /** Near-road exhaust: measured roadside values beside the model's traffic NOx (F5-17); absent in older files. */
  roadside?: Roadside;
}

export interface RoadsideMeasured {
  id: string; tempat: string; zat: string; sumber: string;
  nilai: Array<{ label: string; ug_m3?: number; ppb?: number; min?: number; max?: number }>;
}
export interface Roadside {
  measured: RoadsideMeasured[]; measured_source: string;
  model_latest: Array<{ name: string; run: string; hour_local: number | null; median: number; p90: number; p99: number; source: string }>;
  correction: { note: string; bogor_night_p99_before: number; bogor_night_p99_after: number; bogor_night_max_before: number; bogor_night_max_after: number; source: string;
    night_city?: { p99_after: number; max_after: number } | null };
  limits: string;
}

const REGION_NAME: Record<string, string> = { badung_denpasar: 'Badung-Denpasar', kota_bogor: 'Kota Bogor' };

/** One line per measured comparator, numbers in ug/m3 as written in the source table. */
export function measuredLine(m: RoadsideMeasured): string {
  const v = m.nilai.map((x) => x.ug_m3 != null ? `${x.label} ${num(x.ug_m3, 0)}`
    : x.min != null && x.max != null ? `${x.label} ${num(x.min, 1)}–${num(x.max, 1)}` : `${x.label} ${num(x.max ?? null, 1)}`);
  return `${m.tempat}, ${m.zat}: ${v.join('; ')} µg/m³`;
}

/** The model line of one region: median and p99 of traffic NOx at road midpoints in the named run and hour. */
export function modelLine(r: Roadside['model_latest'][number]): string {
  const hour = r.hour_local != null ? `, jam ${String(r.hour_local).padStart(2, '0')}.00` : '';
  return `${REGION_NAME[r.name] ?? r.name} (run ${r.run}${hour}): median ${num(r.median, 1)}, 99% ruas di bawah ${num(r.p99, 0)} µg/m³ NOx lalu lintas`;
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
