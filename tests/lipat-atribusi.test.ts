import { describe, expect, it } from 'vitest';
import { bolehLipat, TUNDA_LIPAT_MS } from '../src/lib/map/atribusiAturan';

describe('lipat atribusi (OSMF 1.5.2)', () => {
  it('tidak terlipat sebelum lima detik tanpa sentuhan', () => {
    expect(TUNDA_LIPAT_MS).toBe(5000);
    expect(bolehLipat(4999, false)).toBe(false);
    expect(bolehLipat(5000, false)).toBe(true);
  });
  it('sentuhan pertama pada peta melipat lebih awal', () => {
    expect(bolehLipat(800, true)).toBe(true);
  });
});
