import { describe, expect, it } from 'vitest';
import { ISPU_TABLE, ispu, ispuCategory, ispuRounded, pm25Category, type IspuParam } from '../src/lib/ispu';

describe('ISPU (Permen LHK P.14/2020)', () => {
  it('hits 50, 100, 200, 300 and 500 exactly at every breakpoint of every parameter', () => {
    for (const p of Object.keys(ISPU_TABLE) as IspuParam[]) {
      const [c50, c100, c200, c300, c500] = ISPU_TABLE[p];
      expect(ispu(p, 0)).toBe(0);
      expect(ispu(p, c50)).toBeCloseTo(50, 9);
      expect(ispu(p, c100)).toBeCloseTo(100, 9);
      expect(ispu(p, c200)).toBeCloseTo(200, 9);
      expect(ispu(p, c300)).toBeCloseTo(300, 9);
      expect(ispu(p, c500)).toBeCloseTo(500, 9);
      expect(ispu(p, c500 * 2)).toBe(500);
    }
  });

  it('reproduces the worked example of Lampiran I: PM2,5 31,4 µg/m³ -> 69,92 -> 70, Sedang', () => {
    expect(ispu('pm25', 31.4)).toBeCloseTo(69.92, 2);
    expect(ispuRounded('pm25', 31.4)).toBe(70);
    expect(pm25Category(31.4).name).toBe('Sedang');
  });

  it('matches the station example where it agrees with the table (PM10, NO2, O3, HC)', () => {
    expect(ispuRounded('pm10', 35)).toBe(35);
    expect(ispuRounded('no2', 27)).toBe(17);
    expect(ispuRounded('o3', 25)).toBe(10);
    expect(ispuRounded('hc', 21)).toBe(23);
  });

  it('uses the category ranges and colours of Lampiran II', () => {
    expect(ispuCategory(50).name).toBe('Baik');
    expect(ispuCategory(51).name).toBe('Sedang');
    expect(ispuCategory(100).colorName).toBe('Biru');
    expect(ispuCategory(101).name).toBe('Tidak Sehat');
    expect(ispuCategory(201).colorName).toBe('Merah');
    expect(ispuCategory(301).name).toBe('Berbahaya');
    expect(ispuCategory(500).colorName).toBe('Hitam');
  });

  it('rejects invalid concentrations', () => {
    expect(ispu('pm25', -1)).toBeNull();
    expect(ispu('pm25', Number.NaN)).toBeNull();
  });
});

describe('ISPU in the app', () => {
  it('Indonesian is the default language unless English was chosen', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('src/stores/settingsStore.ts', 'utf8');
    expect(s).toMatch(/language: 'id',\n\};/);
    expect(s).toMatch(/raw === 'en' \? 'en' : 'id'/);
  });

  it('the public map legend and the road colours use the ISPU categories', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/pages/ExploreMapPage.tsx', 'utf8')).toMatch(/ISPU_CATEGORIES\.map/);
    const { fieldColor } = await import('../src/lib/field/color');
    const v = { pm25: 31.4, pm25_delta: 0, no2: 0, no2_delta: 0, confidence: 'high' as const, ood: false, pi_half: 0 };
    expect(fieldColor(v, 'aqi', 'total', 0)).toBe(pm25Category(31.4).color);
  });
});
