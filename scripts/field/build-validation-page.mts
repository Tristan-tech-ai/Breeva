/**
 * Data of the public /validasi page (task F5-06), copied from the validation files, never typed by hand.
 *
 *   pnpm exec tsx scripts/field/build-validation-page.mts [--proposal <sumber_proposal/data>] [--field D:/breeva-ml-data/field]
 * Writes public/data/validasi.json. Every number carries the file and key it came from.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const P = arg('proposal', 'C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data');
const F = arg('field', 'D:/breeva-ml-data/field');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const statsI = read(join(P, 'stats_i.json'));
const statsF = read(join(P, 'stats_f.json'));
const statsG = read(join(P, 'stats_g.json'));
const loso = read(join(F, 'validation', 'sensors_bali_loso.json'));
const time = read(join(F, 'validation', 'time_split.json'));
const hum = read(join(F, 'validation', 'humidity_correction_bali.json'));
const bogor = read(join(F, 'reports', 'bogor_stasiun_2026-11-17.json'));

const EPA = { nrmse_pct: 30, r2: 0.7, slope: [0.65, 1.35], intercept: 5 };
const pass = (r: { nrmse_pct: number; r2: number; slope?: number | null; intercept?: number | null }) => {
  const flags = {
    nrmse: r.nrmse_pct <= EPA.nrmse_pct, r2: r.r2 >= EPA.r2,
    slope: r.slope != null && r.slope >= EPA.slope[0] && r.slope <= EPA.slope[1],
    intercept: r.intercept != null && Math.abs(r.intercept) <= EPA.intercept,
  };
  return { flags, passed: Object.values(flags).filter(Boolean).length };
};

const rows = [
  { id: 'bali_hidden', label: 'Bali, sensor warga disembunyikan satu per satu', source: 'sensors_bali_loso.json daily',
    nrmse_pct: loso.daily.nrmse_pct, r2: loso.daily.r_squared, slope: loso.daily.slope, intercept: loso.daily.intercept, n: loso.daily.n },
  { id: 'bali_campaign14', label: 'Ditambah kalibrasi lokasi 14 hari', source: 'stats_i.json kampanye.14.harian',
    nrmse_pct: statsI.kampanye['14'].harian.nrmse_pct, r2: statsI.kampanye['14'].harian.r2, slope: statsI.kampanye['14'].harian.kemiringan,
    intercept: statsI.kampanye['14'].harian.titik_potong, n: statsI.kampanye['14'].harian.n },
  { id: 'bali_sep_oct', label: 'Bali, bulan yang tidak dilatih (Sep–Okt)', source: 'time_split.json kriging_bali.fit_may_aug',
    nrmse_pct: time.kriging_bali.fit_may_aug.nrmse_pct, r2: time.kriging_bali.fit_may_aug.r_squared, slope: time.kriging_bali.fit_may_aug.slope,
    intercept: time.kriging_bali.fit_may_aug.intercept, n: time.kriging_bali.fit_may_aug.n },
  { id: 'city_hidden', label: 'Kota tanpa stasiun, kota disembunyikan', source: 'stats_i.json kota_harian.kalibrasi_pandang_semua',
    nrmse_pct: statsI.kota_harian.kalibrasi_pandang_semua.nrmse_pct, r2: statsI.kota_harian.kalibrasi_pandang_semua.r2, slope: null, intercept: null, n: null },
  { id: 'bogor_nearest', label: 'Kota Bogor: stasiun terdekat (Cibinong, Sentul City), kotanya disembunyikan', source: 'reports/bogor_stasiun_2026-11-17.json gabungan_harian_kalibrasi',
    nrmse_pct: bogor.gabungan_harian_kalibrasi.nrmse_pct, r2: bogor.gabungan_harian_kalibrasi.r2, slope: bogor.gabungan_harian_kalibrasi.slope,
    intercept: bogor.gabungan_harian_kalibrasi.intercept, n: bogor.gabungan_harian_kalibrasi.n },
].map((r) => ({ ...r, ...pass(r) }));

// Near-road exhaust (F5-17): measured roadside values from the literature next to the model's traffic NOx at road
// midpoints in the latest hourly run of each region (read from the private run report at build time).
const BUCKET = 'breeva-field-422509704741';
const aws = (args: string[]) => execFileSync('aws', [...args, '--region', 'ap-southeast-1'], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const latestReport = (name: string) => {
  const runs = aws(['s3', 'ls', `s3://${BUCKET}/audit/${name}/`]).split(/\r?\n/)
    .map((l) => l.trim().replace(/^PRE /, '').replace(/\/$/, '')).filter((x) => /^\d{10}$/.test(x)).sort();
  for (const run of runs.reverse()) {
    try {
      const r = JSON.parse(aws(['s3', 'cp', `s3://${BUCKET}/audit/${name}/${run}/report.json`, '-']));
      if (r.exhaust?.kernel === 'iso1') return { name, run, hour_local: r.inputs?.hourLocal ?? null, median: r.exhaust.nox_median, p90: r.exhaust.nox_p90, p99: r.exhaust.nox_p99, source: `audit/${name}/${run}/report.json exhaust` };
    } catch { /* next */ }
  }
  throw new Error(`no iso1 report for ${name}`);
};
const pembanding = read(join(F, 'reports', 'pembanding_pinggir_jalan.json'));
const f516 = read(join(F, 'reports', 'f5-16_nox.json'));
const bogor22 = f516.uraian_bogor_22;
const roadside = {
  measured: pembanding.pembanding, measured_source: 'reports/pembanding_pinggir_jalan.json',
  model_latest: ['badung_denpasar', 'kota_bogor'].map(latestReport),
  correction: {
    note: 'Koreksi 17 Nov 2026: angin paling rendah 1 m/s (CALINE-3 bagian 8.1.6, ISC3 jilid II bagian 1.1.3) dan tiap separuh jalan dua jalur membawa separuh volume. Lalu malam di kota dihitung netral, bukan stabil (AERMOD, formulasi model bagian 5.10).',
    night_city: f516.malam_kota_D_F5_19 ? { p99_after: f516.malam_kota_D_F5_19.kota_bogor_22.sesudah[0], max_after: f516.malam_kota_D_F5_19.kota_bogor_22.sesudah[1] } : null,
    bogor_night_p99_before: bogor22.sebelum[0], bogor_night_p99_after: bogor22.keduanya[0],
    bogor_night_max_before: bogor22.sebelum[1], bogor_night_max_after: bogor22.keduanya[1],
    source: 'reports/f5-16_nox.json uraian_bogor_22 (run 2026111615, 22.00 WIB)',
  },
  limits: 'Model menghitung NOx lalu lintas tanpa kimia NO -> NO2 dan tanpa udara latar; di pinggir jalan sebagian besar NOx kendaraan berupa NO, jadi NO2 terukur jauh di bawah NOx. Belum ada pengukuran NOx kontinu di Bogor atau Bali.',
};

// F5-24: the same static test scored one day at a time, the way the live map's daily test is scored
const sd = loso.daily_single_day;
const single_day = {
  days: sd.days, passes_count: sd.passes_count, nrmse_pct: sd.nrmse_pct[1], r2: sd.r_squared[1], slope: sd.slope[1], intercept: sd.intercept[1],
  sd_within_day: sd.sd_obs_within_day[1], sd_pooled: sd.sd_obs_pooled, pooled_n: loso.daily.n, pooled_passed: loso.epa_passed,
  source: 'sensors_bali_loso.json daily_single_day (median over days)',
};

const out = {
  built_at: new Date().toISOString(),
  roadside,
  single_day,
  standard: { name: 'EPA, target sensor untuk informasi publik, rata-rata 24 jam (EPA/600/R-20/280)', ...EPA },
  rule: 'Akurasi hanya diklaim dari uji di lokasi yang disembunyikan: lokasi yang dinilai tidak pernah dipakai untuk menebak dirinya sendiri.',
  daily: rows,
  hourly: {
    nrmse_pct: loso.hourly.nrmse_pct, rmse: loso.hourly.rmse, source: 'sensors_bali_loso.json hourly',
    pi95_coverage_before: loso.pi95_hourly_coverage, pi95_coverage_calibrated: loso.pi95_calibrated.coverage_hourly,
    pi95_median_width: loso.pi95_calibrated.median_width_ug_m3,
  },
  city_hourly_rmse: { global_model: statsF.E2.cams.rmse, calibrated_with_visibility: statsF.E2.lin_kosch.rmse, source: 'stats_f.json E2 (cams, lin_kosch)' },
  time_split_calibration: { loco_sep_oct: time.calibration.all.loco_sep_oct, time_and_loco: time.calibration.all.time_loco,
    without_palembang: time.calibration.all_without_palembang.time_loco, cams_without_palembang: time.calibration.all_without_palembang.cams_sep_oct,
    source: 'time_split.json calibration' },
  rejected: [
    { name: 'Kepadatan jalan sebagai fitur', before: statsG.E_bali.idw.rmse, after: statsG.E_bali.idw_x_waktu_jalan.rmse, unit: 'RMSE per jam µg/m³ (Bali, sensor disembunyikan)', source: 'stats_g.json E_bali (idw, idw_x_waktu_jalan)' },
    { name: 'Koreksi kelembapan AS (Barkjohn 2021)', before: hum.B_network_vs_archive_daily.raw.slope, after: hum.B_network_vs_archive_daily.barkjohn_sensor_rh_else_era5.slope, unit: 'kemiringan terhadap stasiun arsip (1 = sempurna)', source: 'humidity_correction_bali.json B_network_vs_archive_daily' },
    { name: 'Cuaca ERA5, cuaca terukur bandara, arah angin, CO/AOD model, jarak ke pantai, ketinggian', before: null, after: null, unit: 'tidak menurunkan galat di uji lokasi disembunyikan', source: 'proposal (analisis E, H, I)' },
  ],
};
writeFileSync('public/data/validasi.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ rows: rows.map((r) => [r.id, r.nrmse_pct, r.passed]), hourly: out.hourly }));
