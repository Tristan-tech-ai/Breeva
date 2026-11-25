/**
 * Running validation of the measurement layer (task F5-07): for the hour a run kriged, hide each sensor in turn,
 * krige its value from the other sensors of that same hour exactly as the engine does (log1p space, the run's
 * variogram, expm1 back, interval widened by pi_scale), and compare with what it read. One hour, hidden-location test;
 * it is NOT the daily EPA target (24-hour means), which docs and the validation page report separately.
 */
import { OrdinaryKriging, type Variogram } from './kriging.js';
import type { MeasuredInputs, SensorReading } from './measure.js';

export interface HourlyValidation {
  scope: string;
  sensor_hour_utc: string | null;
  n: number;
  mean_obs: number;
  rmse: number;
  nrmse: number;
  bias: number;
  /** Squared Pearson correlation of predicted against observed (the R2 of EPA/600/R-20/280). */
  r2: number;
  slope: number;
  intercept: number;
  /** Share of hidden readings inside the 95 % interval. */
  pi95_coverage: number;
}

const round = (x: number, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)) : Number.NaN);

/** Leave-one-sensor-out predictions for one hour (ug/m3) with their 95 % intervals. */
export function looHour(sensors: SensorReading[], v: Variogram, piScale = 1): Array<{ obs: number; pred: number; lo: number; hi: number }> {
  const out: Array<{ obs: number; pred: number; lo: number; hi: number }> = [];
  if (sensors.length < 3) return out;
  for (let i = 0; i < sensors.length; i++) {
    const rest = sensors.filter((_, j) => j !== i);
    const ok = new OrdinaryKriging(rest, v);
    const r = ok.predict(rest.map((s) => Math.log1p(s.pm25)), sensors[i].lat, sensors[i].lon);
    const sd = Math.sqrt(r.variance) * piScale;
    out.push({ obs: sensors[i].pm25, pred: Math.expm1(r.mean), lo: Math.expm1(r.mean - 1.96 * sd), hi: Math.expm1(r.mean + 1.96 * sd) });
  }
  return out;
}

/** The hidden-sensor guesses of the hour, for the daily test (task F5-10); private (audit report only). */
export function hourlyRows(m: MeasuredInputs | undefined): { sensor_hour_utc: string; rows: Array<{ loc_id: number; obs: number; pred: number }> } | null {
  if (!m || m.method !== 'kriging' || !m.variogram_log || !m.sensor_hour_utc) return null;
  const rows = looHour(m.sensors, m.variogram_log, m.pi_scale ?? 1);
  if (!rows.length) return null;
  return { sensor_hour_utc: m.sensor_hour_utc, rows: rows.map((r, k) => ({ loc_id: m.sensors[k].loc_id, obs: r.obs, pred: Number(r.pred.toFixed(2)) })) };
}

/** N-08: hidden-sensor rows of the older hours carried by the run (same variogram and interval scale), oldest first. */
export function earlierRows(m: MeasuredInputs | undefined): Array<{ sensor_hour_utc: string; rows: Array<{ loc_id: number; obs: number; pred: number }> }> {
  if (!m || m.method !== 'kriging' || !m.variogram_log || !m.earlier?.length) return [];
  const out = [];
  for (const e of [...m.earlier].sort((a, b) => a.sensor_hour_utc.localeCompare(b.sensor_hour_utc))) {
    const rows = looHour(e.sensors, m.variogram_log, m.pi_scale ?? 1);
    if (rows.length) out.push({ sensor_hour_utc: e.sensor_hour_utc, rows: rows.map((r, k) => ({ loc_id: e.sensors[k].loc_id, obs: r.obs, pred: Number(r.pred.toFixed(2)) })) });
  }
  return out;
}

export function hourlyValidation(m: MeasuredInputs | undefined): HourlyValidation | null {
  if (!m || m.method !== 'kriging' || !m.variogram_log) return null;
  const rows = looHour(m.sensors, m.variogram_log, m.pi_scale ?? 1);
  if (!rows.length) return null;
  const n = rows.length;
  const mo = rows.reduce((s, r) => s + r.obs, 0) / n, mp = rows.reduce((s, r) => s + r.pred, 0) / n;
  let se = 0, sxy = 0, sxx = 0, syy = 0, inside = 0;
  for (const r of rows) {
    se += (r.pred - r.obs) ** 2;
    sxy += (r.obs - mo) * (r.pred - mp); sxx += (r.obs - mo) ** 2; syy += (r.pred - mp) ** 2;
    if (r.obs >= r.lo && r.obs <= r.hi) inside++;
  }
  const rmse = Math.sqrt(se / n);
  const slope = sxx > 0 ? sxy / sxx : Number.NaN;
  return {
    scope: 'one hour, each sensor hidden in turn and kriged from the others; not the daily EPA target',
    sensor_hour_utc: m.sensor_hour_utc ?? null,
    n, mean_obs: round(mo, 2), rmse: round(rmse, 2), nrmse: round(mo > 0 ? rmse / mo : Number.NaN),
    bias: round(mp - mo, 2), r2: round(sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : Number.NaN),
    slope: round(slope), intercept: round(mp - slope * mo, 2), pi95_coverage: round(inside / n),
  };
}
