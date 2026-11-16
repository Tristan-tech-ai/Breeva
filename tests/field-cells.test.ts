import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCell, encodeCell, saturated, STEP, type CellValue } from '../scripts/field/cells';

const values = JSON.parse(readFileSync('tests/fixtures/cell_small.json', 'utf8')) as CellValue[];

describe('BVF1 value cells', () => {
  it('encodes to the committed fixture byte for byte', () => {
    expect(Buffer.from(encodeCell(values)).equals(readFileSync('tests/fixtures/cell_small.bin'))).toBe(true);
  });

  it('decodes within half a quantisation step, and saturates where the format says', () => {
    const got = decodeCell(encodeCell(values));
    expect(got).toHaveLength(values.length);
    const cap = { pm25_delta: 12.75, no2: 255, no2_delta: 63.75, pi_half: 62 };
    got.forEach((g, k) => {
      const v = values[k];
      for (const col of ['pm25', 'pm25_delta', 'no2', 'no2_delta', 'pi_half'] as const) {
        const want = col === 'pm25' ? v[col] : Math.min(v[col], cap[col]);
        expect(Math.abs(g[col] - want)).toBeLessThanOrEqual(STEP[col] / 2 + 1e-9);
      }
      expect(g.confidence).toBe(v.confidence);
      expect(g.ood).toBe(v.ood);
    });
    expect(saturated('no2_delta', got[1].no2_delta)).toBe(true);
    expect(saturated('no2_delta', got[0].no2_delta)).toBe(false);
  });

  it('long-tail scale keeps busy-road values the linear scale would cut off', () => {
    const big: CellValue[] = [
      { ...values[0], pm25_delta: 4, no2: 120, no2_delta: 30 },      // below the knees: same steps as the linear scale
      { ...values[0], pm25_delta: 18.1, no2: 400, no2_delta: 143 },  // a trunk road in a calm evening
      { ...values[0], pm25_delta: 500, no2: 5000, no2_delta: 5000 }, // beyond the top: held at the top
    ];
    const got = decodeCell(encodeCell(big, 'tail'));
    expect(got[0].pm25_delta).toBeCloseTo(4, 9);
    expect(got[0].no2).toBe(120);
    expect(got[0].no2_delta).toBeCloseTo(30, 9);
    for (const col of ['pm25_delta', 'no2', 'no2_delta'] as const) {
      expect(Math.abs(got[1][col] / big[1][col] - 1)).toBeLessThan(0.03); // geometric steps of under 6%
      expect(saturated(col, got[2][col], 'tail')).toBe(true);
      expect(saturated(col, got[1][col], 'tail')).toBe(false);
    }
    expect(got[2].no2_delta).toBeCloseTo(1000, 6);
    // the linear scale (runs before 16 Nov 2026) still decodes as before, and cuts the same road at 63.75
    expect(decodeCell(encodeCell(big))[1].no2_delta).toBe(63.75);
    // values on both scales read the same below the knee, so an older client is never wrong there
    const linear = encodeCell([big[0]]), tail = encodeCell([big[0]], 'tail');
    expect(Buffer.from(linear.subarray(12)).equals(Buffer.from(tail.subarray(12)))).toBe(true);
  });

  it('refuses non-finite values and malformed files', () => {
    expect(() => encodeCell([{ ...values[0], pm25: Number.NaN }])).toThrow();
    const bad = encodeCell(values).slice(0, 20);
    expect(() => decodeCell(bad)).toThrow();
  });
});
