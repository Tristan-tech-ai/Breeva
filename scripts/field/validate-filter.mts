/**
 * Task F5-08: does rule S1 (scripts/field/sensor-filter.ts) make the measurement layer better at hidden sensors?
 * Design pre-registered in .claude/loop/DECISIONS.md (16 Nov) before this ran: 28 vetted Bali citizen sensors, every
 * hour of the proposal's OpenAQ history, log-space ordinary kriging with the production variogram; each sensor hidden in
 * turn and kriged from the other sensors of that hour, unfiltered (arm A) or filtered by S1 (arm B). Targets: readings
 * S1 keeps (the same for both arms), at least 3 other sensors in both arms. Primary: hourly NRMSE. Secondary: daily EPA
 * statistics (sensor-days with >= 18 hours) and the change of each sensor's hourly RMSE.
 *
 *   pnpm exec tsx scripts/field/validate-filter.mts [--data <sumber_proposal/data>] [--out D:/breeva-ml-data/field/validation]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { OrdinaryKriging } from './kriging.js';
import { s1Keep } from './sensor-filter.js';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const DATA = arg('data', 'C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data')!;
const OUT = arg('out', 'D:/breeva-ml-data/field/validation')!;
const params = JSON.parse(readFileSync('scripts/field/params/measure.json', 'utf8'));
const v = params.regions.badung_denpasar.variogram_log;

function csv(text: string): Record<string, string>[] {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(','));
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

const sensors = csv(readFileSync(join(DATA, 'sensor_warga_bali.csv'), 'utf8'));
const where = new Map(sensors.map((s) => [Number(s.loc_id), { lat: Number(s.lat), lon: Number(s.lon) }]));
const byHour = new Map<string, Map<number, number>>();
for (const r of csv(gunzipSync(readFileSync(join(DATA, 'openaq_jam.csv.gz'))).toString('utf8'))) {
  const id = Number(r.loc_id), x = Number(r.pm25);
  if (!where.has(id) || !(x >= 0 && x < 1000)) continue;
  const th = new Date(r.th).toISOString();
  let m = byHour.get(th);
  if (!m) { m = new Map(); byHour.set(th, m); }
  if (!m.has(id)) m.set(id, x);
}
const hours = [...byHour.keys()].sort();

type Row = { id: number; hour: string; obs: number; a: number; b: number; kept: boolean };
const rows: Row[] = [];
let flagged = 0, readings = 0;
const krige = (others: Array<{ lat: number; lon: number; pm25: number }>, at: { lat: number; lon: number }) =>
  Math.expm1(new OrdinaryKriging(others, v).predict(others.map((o) => Math.log1p(o.pm25)), at.lat, at.lon).mean);

const t0 = Date.now();
for (const h of hours) {
  const rs = [...byHour.get(h)!].map(([id, pm25]) => ({ id, pm25, ...where.get(id)! }));
  if (rs.length < 4) continue;
  const keep = s1Keep(rs);
  readings += rs.length;
  flagged += keep.filter((k) => !k).length;
  rs.forEach((r, i) => {
    const othersA = rs.filter((_, j) => j !== i);
    const othersB = othersA.filter((o) => keep[rs.indexOf(o)]);
    if (othersA.length < 3 || othersB.length < 3) return;
    rows.push({ id: r.id, hour: h, obs: r.pm25, a: krige(othersA, r), b: krige(othersB, r), kept: keep[i] });
  });
}

function metrics(pred: number[], obs: number[]) {
  const n = pred.length;
  const mo = obs.reduce((s, x) => s + x, 0) / n, mp = pred.reduce((s, x) => s + x, 0) / n;
  let se = 0, sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { se += (pred[k] - obs[k]) ** 2; sxy += (obs[k] - mo) * (pred[k] - mp); sxx += (obs[k] - mo) ** 2; syy += (pred[k] - mp) ** 2; }
  const rmse = Math.sqrt(se / n), slope = sxy / sxx;
  const f = (x: number, d = 3) => Number(x.toFixed(d));
  return { n, rmse: f(rmse, 2), nrmse: f(rmse / mo), r2: f((sxy * sxy) / (sxx * syy)), slope: f(slope), intercept: f(mp - slope * mo, 2) };
}
function daily(rs: Row[], arm: 'a' | 'b') {
  const days = new Map<string, { p: number; o: number; n: number }>();
  for (const r of rs) {
    const key = `${r.id}|${new Date(Date.parse(r.hour) + 8 * 3600_000).toISOString().slice(0, 10)}`;
    const d = days.get(key) ?? { p: 0, o: 0, n: 0 };
    d.p += r[arm]; d.o += r.obs; d.n++;
    days.set(key, d);
  }
  const ok = [...days.values()].filter((d) => d.n >= 18);
  return metrics(ok.map((d) => d.p / d.n), ok.map((d) => d.o / d.n));
}

const targets = rows.filter((r) => r.kept);
const perSensor = [...where.keys()].map((id) => {
  const rs = targets.filter((r) => r.id === id);
  if (rs.length < 50) return null;
  const a = metrics(rs.map((r) => r.a), rs.map((r) => r.obs)).rmse, b = metrics(rs.map((r) => r.b), rs.map((r) => r.obs)).rmse;
  return { id, n: rs.length, rmse_a: a, rmse_b: b, change: Number((b / a - 1).toFixed(3)) };
}).filter((x): x is NonNullable<typeof x> => x !== null);

const A = metrics(targets.map((r) => r.a), targets.map((r) => r.obs)), B = metrics(targets.map((r) => r.b), targets.map((r) => r.obs));
const dA = daily(targets, 'a'), dB = daily(targets, 'b');
const worst = perSensor.reduce((m, s) => Math.max(m, s.change), -Infinity);
const adopt = B.nrmse < A.nrmse && worst <= 0.10 && dB.nrmse <= dA.nrmse;
const report = {
  rule: 'S1: drop x < 1, or x > 5*m or x < m/5 where m = median of the 3 nearest other sensors that hour and m >= 5',
  data: { hours: hours.length, readings, flagged, flagged_share: Number((flagged / readings).toFixed(4)), sensors: where.size },
  primary_hourly_kept_targets: { A_unfiltered: A, B_s1: B },
  daily_epa_kept_targets: { A_unfiltered: dA, B_s1: dB },
  all_targets_including_flagged: {
    A_unfiltered: metrics(rows.map((r) => r.a), rows.map((r) => r.obs)), B_s1: metrics(rows.map((r) => r.b), rows.map((r) => r.obs)),
  },
  per_sensor_worst_rmse_change: worst, per_sensor: perSensor,
  decision: adopt ? 'adopt S1 in the builder' : 'do not adopt (pre-registered criteria not met)',
  seconds: (Date.now() - t0) / 1000,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'filter_s1.json'), JSON.stringify(report, null, 1));
const { per_sensor: _p, ...brief } = report;
console.log(JSON.stringify(brief));
