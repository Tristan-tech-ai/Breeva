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

  it('refuses non-finite values and malformed files', () => {
    expect(() => encodeCell([{ ...values[0], pm25: Number.NaN }])).toThrow();
    const bad = encodeCell(values).slice(0, 20);
    expect(() => decodeCell(bad)).toThrow();
  });
});
