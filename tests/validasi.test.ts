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
