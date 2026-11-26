import { describe, expect, it } from 'vitest';
import { capVersi } from '../src/lib/versi';

describe('capVersi', () => {
  it('menulis waktu build dalam WIB dan 7 huruf commit', () => {
    expect(capVersi('2026-11-26T11:40:00.000Z', 'ff8fc2a')).toBe('26 Nov 2026, 18.40 WIB · ff8fc2a');
  });
  it('pindah hari saat UTC sore', () => {
    expect(capVersi('2026-11-26T17:05:00.000Z', 'abc1234')).toBe('27 Nov 2026, 00.05 WIB · abc1234');
  });
  it('tanpa waktu build tetap menulis commit', () => {
    expect(capVersi('', 'dev')).toBe('versi dev');
  });
});
