import { describe, expect, it } from 'vitest';
import { kenaIkon, TAP_IKON_PX } from '../src/lib/map/sentuhIkon';

describe('M-U11 sentuhan ikon tempat', () => {
  it('ikon tempat hanya menangkap ketukan dalam 14 px', () => {
    expect(TAP_IKON_PX).toBe(14);
    expect(kenaIkon(0, 0, 20, false)).toBe(true);
    expect(kenaIkon(10, 9, 20, false)).toBe(true);
    expect(kenaIkon(15, 0, 20, false)).toBe(false);
    expect(kenaIkon(20, 20, 20, false)).toBe(false); // the old 52 px square took this
  });
  it('ikon kecil memakai setengah ukurannya', () => {
    expect(kenaIkon(9, 0, 8, false)).toBe(false);
    expect(kenaIkon(7, 0, 8, false)).toBe(true);
  });
  it('kluster tetap lebar', () => {
    expect(kenaIkon(23, 23, 20, true)).toBe(true);
    expect(kenaIkon(25, 0, 20, true)).toBe(false);
  });
});
