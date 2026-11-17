/**
 * Hidden-sensor test of the field's measurement layer (task F2-07): each Bali citizen sensor in turn is left out and
 * predicted, hour by hour, by log-space ordinary kriging of the others (scripts/field/kriging.ts), the variogram refitted
 * without it. Same data and steps as the proposal's analysis H (estimator ok_log), so the daily NRMSE must come back at
 * no more than 23 % (stats_h.json: 22.9 %). Also reports the EPA daily targets (R2, slope, intercept) and how often the
 * 95 % kriging interval holds the hidden hourly reading.
 *
 *   pnpm exec tsx scripts/field/validate-sensors.mts [--data <sumber_proposal/data>] [--out <dir>] [--params <json>]
 *
 * --params writes the variogram fitted on all sensors plus the vetted sensor list for the field builder.
 * Exit 1 when the daily NRMSE is above 23 %.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { distanceMatrix, fitVariogram, looPredict, nestedIntervalScale, pairStats } from './kriging.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { cur.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(f); rows.push(cur); cur = []; f = ''; }
    else f += ch;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

const DATA = arg('data', 'C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data')!;
const OUT = arg('out', 'D:/breeva-ml-data/field/validation')!;
const sensors = csv(readFileSync(join(DATA, 'sensor_warga_bali.csv'), 'utf8'));
const ids = sensors.map((s) => Number(s.loc_id));
const idSet = new Set(ids);
const hourly = csv(gunzipSync(readFileSync(join(DATA, 'openaq_jam.csv.gz'))).toString('utf8'));

// Pivot hour x sensor, keeping 0 <= pm25 < 1000 and the first row per (sensor, hour), as analisis_h does.
const byHour = new Map<string, Map<number, number>>();
for (const r of hourly) {
  const id = Number(r.loc_id), v = Number(r.pm25);
  if (!idSet.has(id) || !(v >= 0 && v < 1000)) continue;
  const th = new Date(r.th).toISOString();
  let m = byHour.get(th);
  if (!m) { m = new Map(); byHour.set(th, m); }
  if (!m.has(id)) m.set(id, v);
}
const hours = [...byHour.keys()].sort();
const N = ids.length, T = hours.length;
const V = ids.map((id) => Float64Array.from(hours, (h) => byHour.get(h)!.get(id) ?? Number.NaN));
const Y = V.map((c) => c.map((x) => Math.log1p(x)));
const pts = sensors.map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }));
const D = distanceMatrix(pts);
const { G, W } = pairStats(Y);

const t0 = Date.now();
const P = ids.map(() => new Float64Array(T).fill(Number.NaN));
const LO = ids.map(() => new Float64Array(T).fill(Number.NaN));
const HI = ids.map(() => new Float64Array(T).fill(Number.NaN));
const MU = ids.map(() => new Float64Array(T).fill(Number.NaN));
const SD = ids.map(() => new Float64Array(T).fill(Number.NaN));
const Z: number[][] = ids.map(() => []);
for (let i = 0; i < N; i++) {
  const v = fitVariogram(G, W, D, i);
  const { mean, variance } = looPredict(Y, D, i, v);
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(V[i][t]) || !Number.isFinite(mean[t])) continue;
    const s = Math.sqrt(variance[t]);
    P[i][t] = Math.expm1(mean[t]);
    LO[i][t] = Math.expm1(mean[t] - 1.96 * s);
    HI[i][t] = Math.expm1(mean[t] + 1.96 * s);
    MU[i][t] = mean[t]; SD[i][t] = s;
    if (s > 0) Z[i].push((Y[i][t] - mean[t]) / s);
  }
}
// Interval calibration (task F5-05): nested per-sensor widening factor, then coverage and width with it.
const scale = nestedIntervalScale(Z);
let insideCal = 0, nCal = 0;
const widths: number[] = [];
for (let i = 0; i < N; i++) for (let t = 0; t < T; t++) {
  if (!Number.isFinite(P[i][t]) || !Number.isFinite(SD[i][t])) continue;
  const k = scale.perSensor[i];
  const lo = Math.expm1(MU[i][t] - 1.96 * k * SD[i][t]), hi = Math.expm1(MU[i][t] + 1.96 * k * SD[i][t]);
  nCal++;
  if (V[i][t] >= lo && V[i][t] <= hi) insideCal++;
  widths.push(hi - lo);
}
widths.sort((a, b) => a - b);

function metrics(pred: number[], obs: number[]) {
  const n = pred.length;
  const mo = obs.reduce((s, x) => s + x, 0) / n, mp = pred.reduce((s, x) => s + x, 0) / n;
  let se = 0, ae = 0, sb = 0, sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    const e = pred[k] - obs[k];
    se += e * e; ae += Math.abs(e); sb += e;
    sxy += (obs[k] - mo) * (pred[k] - mp); sxx += (obs[k] - mo) ** 2; syy += (pred[k] - mp) ** 2;
  }
  const rmse = Math.sqrt(se / n), r = sxy / Math.sqrt(sxx * syy), slope = sxy / sxx;
  const r2 = (x: number, d = 2) => Number(x.toFixed(d));
  return {
    n, rmse: r2(rmse), mae: r2(ae / n), nrmse_pct: r2((100 * rmse) / mo, 1), nmb_pct: r2((100 * sb) / (mo * n), 1),
    r: r2(r, 3), r_squared: r2(r * r, 3), slope: r2(slope, 3), intercept: r2(mp - slope * mo, 2),
  };
}

// Hourly pairs.
const hp: number[] = [], ho: number[] = [];
let inside = 0;
for (let i = 0; i < N; i++) for (let t = 0; t < T; t++) {
  if (!Number.isFinite(P[i][t])) continue;
  hp.push(P[i][t]); ho.push(V[i][t]);
  if (V[i][t] >= LO[i][t] && V[i][t] <= HI[i][t]) inside++;
}
// Daily means in WITA (UTC+8), days with at least 18 hours, prediction masked to the hours the sensor reported.
const dp: number[] = [], dob: number[] = [], dday: string[] = [];
for (let i = 0; i < N; i++) {
  const days = new Map<string, { p: number; o: number; np: number; no: number }>();
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(V[i][t])) continue;
    const day = new Date(Date.parse(hours[t]) + 8 * 3600_000).toISOString().slice(0, 10);
    let d = days.get(day);
    if (!d) { d = { p: 0, o: 0, np: 0, no: 0 }; days.set(day, d); }
    d.o += V[i][t]; d.no++;
    if (Number.isFinite(P[i][t])) { d.p += P[i][t]; d.np++; }
  }
  for (const [day, d] of days) if (d.no >= 18 && d.np >= 18) { dp.push(d.p / d.np); dob.push(d.o / d.no); dday.push(day); }
}
const daily = metrics(dp, dob);
// Per hidden sensor (F5-25): its daily bias and how much of its hourly under-prediction comes from its worst hours.
const perSensor = ids.map((id, i) => {
  const days = new Map<string, { p: number; o: number; n: number }>();
  const errs: number[] = [];
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(V[i][t]) || !Number.isFinite(P[i][t])) continue;
    errs.push(P[i][t] - V[i][t]);
    const day = new Date(Date.parse(hours[t]) + 8 * 3600_000).toISOString().slice(0, 10);
    const d = days.get(day) ?? { p: 0, o: 0, n: 0 };
    d.p += P[i][t]; d.o += V[i][t]; d.n++; days.set(day, d);
  }
  const db = [...days.values()].filter((d) => d.n >= 18).map((d) => (d.p - d.o) / d.n);
  const neg = errs.filter((e) => e < 0).map((e) => -e).sort((a, b) => b - a);
  const negSum = neg.reduce((s, x) => s + x, 0), top = neg.slice(0, Math.max(1, Math.ceil(0.05 * errs.length))).reduce((s, x) => s + x, 0);
  const r2 = (x: number, d = 2) => Number(x.toFixed(d));
  return {
    loc_id: id, name: sensors[i].name, days: db.length, hours: errs.length,
    daily_bias_mean: db.length ? r2(db.reduce((s, x) => s + x, 0) / db.length) : null,
    share_days_bias_le_minus5: db.length ? r2(db.filter((x) => x <= -5).length / db.length, 3) : null,
    share_under_from_worst_5pct_hours: negSum > 0 ? r2(top / negSum, 3) : null,
  };
});
// The same daily pairs scored one day at a time, as the live map's daily test does (F5-24): within a single day the
// sensors differ much less than across days, so R2 and slope measure only the spatial pattern of that day.
const byDay = new Map<string, number[]>();
dday.forEach((d, k) => { const a = byDay.get(d) ?? []; a.push(k); byDay.set(d, a); });
const singleDays = [...byDay.entries()].filter(([, ks]) => ks.length >= 10).map(([day, ks]) => {
  const m = metrics(ks.map((k) => dp[k]), ks.map((k) => dob[k]));
  const sd = Math.sqrt(ks.reduce((s, k) => s + (dob[k] - ks.reduce((t, j) => t + dob[j], 0) / ks.length) ** 2, 0) / ks.length);
  const passes = [m.nrmse_pct <= 30, m.r_squared >= 0.7, Math.abs(m.slope - 1) <= 0.35, Math.abs(m.intercept) <= 5].filter(Boolean).length;
  return { day, n: ks.length, sd_obs: sd, ...m, passes };
});
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? Number(s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))].toFixed(3)) : null; };
const sdAll = Math.sqrt(dob.reduce((s, x) => s + (x - dob.reduce((t, y) => t + y, 0) / dob.length) ** 2, 0) / dob.length);
const dailySingleDay = {
  method: 'daily pairs above, grouped by WITA day, days with >= 10 sensors; quantiles 10/50/90 over days',
  days: singleDays.length, sd_obs_pooled: Number(sdAll.toFixed(2)),
  sd_obs_within_day: [0.1, 0.5, 0.9].map((p) => q(singleDays.map((d) => d.sd_obs), p)),
  nrmse_pct: [0.1, 0.5, 0.9].map((p) => q(singleDays.map((d) => d.nrmse_pct), p)),
  r_squared: [0.1, 0.5, 0.9].map((p) => q(singleDays.map((d) => d.r_squared), p)),
  slope: [0.1, 0.5, 0.9].map((p) => q(singleDays.map((d) => d.slope), p)),
  intercept: [0.1, 0.5, 0.9].map((p) => q(singleDays.map((d) => d.intercept), p)),
  passes_count: [0, 1, 2, 3, 4].map((k) => singleDays.filter((d) => d.passes === k).length),
};
const hourlyM = metrics(hp, ho);
const all = fitVariogram(G, W, D);
const epa = {
  nrmse_le_30: daily.nrmse_pct <= 30, r2_ge_070: daily.r_squared >= 0.7,
  slope_1_pm_035: Math.abs(daily.slope - 1) <= 0.35, intercept_pm_5: Math.abs(daily.intercept) <= 5,
};
const report = {
  test: 'leave-one-sensor-out, log-space ordinary kriging (port of analisis_h ok_log)',
  data: { sensors: N, hours: T, from: hours[0], to: hours[T - 1], source: 'OpenAQ v3 /sensors/{id}/hours (AirGradient), CC BY 4.0' },
  reference: 'sumber_proposal/data/stats_h.json penduga.ok_log: harian nrmse 22.9 %, rmse 7.92, r 0.817, n 1470',
  hourly: hourlyM, daily, daily_single_day: dailySingleDay, per_sensor: perSensor, epa_daily_targets: epa, epa_passed: Object.values(epa).filter(Boolean).length,
  pi95_hourly_coverage: Number((inside / hp.length).toFixed(3)),
  pi95_calibrated: {
    method: 'nested: factor for each hidden sensor = 95th percentile of |z| over the other sensors / 1.96',
    coverage_hourly: Number((insideCal / nCal).toFixed(3)), n: nCal,
    median_width_ug_m3: Number(widths[Math.floor(widths.length / 2)].toFixed(1)),
    factor_all_sensors: Number(scale.all.toFixed(3)),
    factor_range: [Number(Math.min(...scale.perSensor).toFixed(3)), Number(Math.max(...scale.perSensor).toFixed(3))],
  },
  variogram_all_sensors_log: all, seconds: (Date.now() - t0) / 1000,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'sensors_bali_loso.json'), JSON.stringify(report, null, 1));

const paramsPath = arg('params');
if (paramsPath) {
  const prev = (() => { try { return JSON.parse(readFileSync(paramsPath, 'utf8')); } catch { return { regions: {} }; } })();
  prev.regions ??= {};
  const net = {
    network: 'openaq', min_sensors: 3, variogram_log: all, pi_scale: Number(scale.all.toFixed(3)),
    fitted: { from: hours[0], to: hours[T - 1], hours: T, sensors: N, script: 'scripts/field/validate-sensors.mts' },
    sensors: sensors.map((s) => ({ loc_id: Number(s.loc_id), sensor_id: Number(s.sensor_id), name: s.name, lat: Number(s.lat), lon: Number(s.lon) })),
  };
  prev.regions.badung_denpasar = { ...(prev.regions.badung_denpasar ?? {}), ...net };
  writeFileSync(paramsPath, JSON.stringify(prev, null, 1) + '\n');
}
console.log(JSON.stringify({ hourly: hourlyM, daily, epa_passed: report.epa_passed, pi95_hourly_coverage: report.pi95_hourly_coverage, pi95_calibrated: report.pi95_calibrated, variogram: all, seconds: report.seconds }));
if (!(daily.nrmse_pct <= 23)) { console.error(`daily NRMSE ${daily.nrmse_pct} % is above 23 %`); process.exit(1); }
