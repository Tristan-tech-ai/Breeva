import { describe, expect, it } from 'vitest';
import { tanggalId } from '../src/lib/tanggalId';

describe('tanggalId', () => {
  it('writes ISO dates the Indonesian way', () => {
    expect(tanggalId('2026-09-01')).toBe('1 Sep 2026');
    expect(tanggalId('2026-11-25')).toBe('25 Nov 2026');
  });
  it('keeps the time with a dot', () => {
    expect(tanggalId('2026-11-25 20:18')).toBe('25 Nov 2026 20.18');
  });
  it('leaves other text unchanged', () => {
    expect(tanggalId('kemarin')).toBe('kemarin');
    expect(tanggalId('2026-13-01')).toBe('2026-13-01');
  });
});
