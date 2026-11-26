import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HargaIndex, HARGA_COLORS } from '../src/lib/field/harga';

// Written by vayu/field/make_harga_fixture.py with the Python writer (vayu/field/harga_hirup.py write_client).
const h = new HargaIndex(new Uint8Array(readFileSync('tests/fixtures/harga_small.bin')));
const want = JSON.parse(readFileSync('tests/fixtures/harga_small.json', 'utf8')) as {
  meta: { n: number; quintiles: number[]; cell_offsets: number[] }; rows: Array<{ c: number; i: number; h: number }>;
};

describe('harga hirup reader (TypeScript) against the Python writer', () => {
  it('reads the header', () => {
    expect(h.meta.format).toBe('BHI1');
    expect(h.meta.n).toBe(want.meta.n);
    expect(h.meta.cell_offsets).toEqual(want.meta.cell_offsets);
  });

  it('reads every road by (c, i)', () => {
    for (const r of want.rows) expect(h.value(r.c, r.i)!).toBeCloseTo(r.h, 6);
    expect(h.value(99, 0)).toBeNull();
    const last = want.meta.cell_offsets.length - 2;
    expect(h.value(last, want.meta.cell_offsets[last + 1] - want.meta.cell_offsets[last])).toBeNull();
  });

  it('puts about a fifth of the roads in each fixed class', () => {
    const counts = [0, 0, 0, 0, 0];
    for (const r of want.rows) counts[h.klass(r.h)]++;
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(7);
    expect(HARGA_COLORS).toHaveLength(5);
  });
});

describe('the Badung-Denpasar harga hirup file', () => {
  let bytes: Uint8Array | null = null;
  try { bytes = new Uint8Array(readFileSync('D:/breeva-ml-data/field/harga/2026-11/client/badung_denpasar.bin')); } catch { bytes = null; }
  it.runIf(bytes !== null)('covers every road of the pack with a median of 1', () => {
    const big = new HargaIndex(bytes!);
    expect(big.meta.n).toBe(60961);
    const o = big.meta.cell_offsets;
    expect(o[o.length - 1]).toBe(60961);
    const vals: number[] = [];
    for (let c = 0; c + 1 < o.length; c++) for (let i = 0; i < o[c + 1] - o[c]; i++) vals.push(big.value(c, i)!);
    vals.sort((a, b) => a - b);
    expect(vals[Math.floor(vals.length / 2)]).toBeCloseTo(1, 1);
  });
});

describe('road popup', () => {
  it('shows the harga hirup of the road when the region has the file, and nothing when not', async () => {
    const { popupHtml } = await import('../src/lib/field/popup');
    const v = { pm25: 24.3, pm25_delta: 0.7, no2: 17, no2_delta: 10.5, confidence: 'high' as const, ood: false, pi_half: 14 };
    const r = want.rows[10];
    const src = { ageHours: () => 0.5, isStale: () => false, manifest: null, harga: h };
    const html = popupHtml(v, 'Jalan Teuku Umar', src, r.c, r.i);
    expect(html).toContain(`harga hirup ${r.h.toFixed(2).replace('.', ',')}× median wilayah`);
    expect(html).toContain('(NOx lalu lintas): 10,5 µg/m³'); // N-68: Indonesian decimals
    expect(html).toContain('PM2,5 24,3 µg/m³');
    expect(html).not.toMatch(/\d\.\d/);
    expect(popupHtml(v, undefined, { ...src, harga: null }, r.c, r.i)).not.toContain('harga hirup');
  });
});

describe('95 % interval in the popup', () => {
  it('a kriged value has a log-symmetric interval around its ambient; other runs are symmetric', async () => {
    const { interval95 } = await import('../src/lib/field/popup');
    // ambient 24 (delta 1): kriging gives exp(mu +- 1.96 k sd) - 1, here hi_a = 3 * (1 + 24) - 1 = 74
    const v = { pm25: 25, pm25_delta: 1, pi_half: 50 };
    const [lo, hi] = interval95(v, 'kriging');
    expect(hi).toBe(75);
    expect(lo).toBeCloseTo((1 + 24) / 3 - 1 + 1, 6); // (1 + a)^2 / (1 + hi_a) - 1 + delta = 25/3 - 1 + 1
    expect(interval95(v, 'none')).toEqual([0, 75]);
    expect(interval95({ pm25: 40, pm25_delta: 0, pi_half: 10 }, undefined)).toEqual([30, 50]);
  });
});
