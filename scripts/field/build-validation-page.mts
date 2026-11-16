/**
 * Data of the public /validasi page (task F5-06), copied from the validation files, never typed by hand.
 *
 *   pnpm exec tsx scripts/field/build-validation-page.mts [--proposal <sumber_proposal/data>] [--field D:/breeva-ml-data/field]
 * Writes public/data/validasi.json. Every number carries the file and key it came from.
 */
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
].map((r) => ({ ...r, ...pass(r) }));

const out = {
  built_at: new Date().toISOString(),
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
