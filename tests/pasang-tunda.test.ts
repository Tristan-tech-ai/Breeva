import { describe, expect, it } from 'vitest';
import { bolehTampil, TUNDA_PASANG_MS } from '../src/lib/pasang';

describe('install banner waits a minute (N-104)', () => {
  it('stays hidden in the first minute of a session, then shows when Chrome offers an install', () => {
    expect(TUNDA_PASANG_MS).toBe(60_000);
    expect(bolehTampil(true, false, '/pantau', 30_000)).toBe(false);
    expect(bolehTampil(true, false, '/pantau', 60_000)).toBe(true);
  });
  it('never shows without an offer, after a dismissal, or on /developers', () => {
    expect(bolehTampil(false, false, '/pantau', 120_000)).toBe(false);
    expect(bolehTampil(true, true, '/pantau', 120_000)).toBe(false);
    expect(bolehTampil(true, false, '/developers', 120_000)).toBe(false);
  });
});
