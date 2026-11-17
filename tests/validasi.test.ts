import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { epaFlags, verdict, type Validasi } from '../src/lib/validasi';

const v = JSON.parse(readFileSync('public/data/validasi.json', 'utf8')) as Validasi;

describe('public validation page data', () => {
  it('every EPA flag and pass count follows from its numbers', () => {
    for (const r of v.daily) {
      const { flags, passed } = epaFlags(r, v.standard);
      expect(flags).toEqual(r.flags);
      expect(passed).toBe(r.passed);
    }
    expect(verdict(4)).toMatch(/akurat/);
    expect(verdict(2)).not.toMatch(/akurat/);
    expect(verdict(0)).toMatch(/indikatif/);
  });

  it('a city without stations is never called accurate', () => {
    const city = v.daily.find((r) => r.id === 'city_hidden')!;
    expect(city.passed).toBeLessThan(4);
  });

  const loso = 'D:/breeva-ml-data/field/validation/sensors_bali_loso.json';
  it.runIf(existsSync(loso))('numbers equal the validation files they came from', () => {
    const l = JSON.parse(readFileSync(loso, 'utf8'));
    const bali = v.daily.find((r) => r.id === 'bali_hidden')!;
    expect([bali.nrmse_pct, bali.r2, bali.slope, bali.intercept, bali.n]).toEqual([l.daily.nrmse_pct, l.daily.r_squared, l.daily.slope, l.daily.intercept, l.daily.n]);
    expect(v.hourly.pi95_coverage_calibrated).toBe(l.pi95_calibrated.coverage_hourly);
    const t = JSON.parse(readFileSync('D:/breeva-ml-data/field/validation/time_split.json', 'utf8'));
    expect(v.daily.find((r) => r.id === 'bali_sep_oct')!.nrmse_pct).toBe(t.kriging_bali.fit_may_aug.nrmse_pct);
    const s = JSON.parse(readFileSync('C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data/stats_i.json', 'utf8'));
    expect(v.daily.find((r) => r.id === 'bali_campaign14')!.slope).toBe(s.kampanye['14'].harian.kemiringan);
  });
});

describe('near-road exhaust comparison (F5-17)', async () => {
  const { measuredLine, modelLine } = await import('../src/lib/validasi');
  it('the page data carries the measured comparators, the latest run of both regions and the correction', () => {
    const r = v.roadside!;
    expect(r.measured.map((m) => m.id)).toEqual(['bangkok_nox', 'bogor_dramaga_no2', 'bogor_tol_no2']);
    expect(r.model_latest.map((m) => m.name)).toEqual(['badung_denpasar', 'kota_bogor']);
    for (const m of r.model_latest) {
      expect(m.source).toMatch(/^audit\/.+\/\d{10}\/report\.json exhaust$/);
      expect(m.p99).toBeGreaterThan(m.median);
    }
    expect(r.correction.bogor_night_p99_after).toBeLessThan(r.correction.bogor_night_p99_before);
    expect(r.limits).toMatch(/NO -> NO2/);
  });

  it('lines read as written in the sources, in ug/m3', () => {
    expect(measuredLine({ id: 'x', tempat: 'Bangkok', zat: 'NOx', sumber: 's', nilai: [{ label: 'rata-rata', ug_m3: 172, ppb: 91.4 }] }))
      .toBe('Bangkok, NOx: rata-rata 172 µg/m³');
    expect(measuredLine({ id: 'y', tempat: 'Dramaga', zat: 'NO2', sumber: 's', nilai: [{ label: 'rentang', min: 8.54, max: 30.9 }] }))
      .toBe('Dramaga, NO2: rentang 8,5–30,9 µg/m³');
    expect(modelLine({ name: 'kota_bogor', run: '2026111712', hour_local: 19, median: 4.48, p90: 35.7, p99: 195.83, source: 's' }))
      .toBe('Kota Bogor (run 2026111712, jam 19.00): median 4,5, 99% ruas di bawah 196 µg/m³ NOx lalu lintas');
  });
});
