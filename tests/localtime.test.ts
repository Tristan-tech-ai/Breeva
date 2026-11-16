import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localClock, utcOffsetHours } from '../api/vayu/_localtime';

describe('local clock', () => {
  it('07:00 UTC is 15:00 in Bali and 14:00 in Jakarta and Bogor', () => {
    const at = new Date('2026-11-16T07:00:00Z');
    expect(localClock(-8.65, 115.21, at).hour).toBe(15);  // Denpasar, WITA
    expect(localClock(-6.2, 106.82, at).hour).toBe(14);   // Jakarta, WIB
    expect(localClock(-6.6, 106.8, at).hour).toBe(14);    // Bogor, WIB
  });

  it('does not depend on the machine time zone', () => {
    // Same instant, computed twice: the result is a function of the instant and the place only.
    const at = new Date(Date.UTC(2026, 10, 16, 23, 30));
    const c = localClock(-8.65, 115.21, at);
    expect(c).toEqual({ hour: 7, month: 11, dow: 2, ymd: '2026-11-17', offset: 8 }); // next morning in Bali, a Tuesday
  });

  it('shifts by the forecast offset across midnight and month end', () => {
    const at = new Date('2026-11-30T15:00:00Z'); // 23:00 WITA on 30 Nov
    const c = localClock(-8.65, 115.21, at, 2);
    expect([c.hour, c.month, c.ymd]).toEqual([1, 12, '2026-12-01']);
  });

  it('knows the three Indonesian zones', () => {
    expect(utcOffsetHours(-6.2, 106.8)).toBe(7);    // Jakarta
    expect(utcOffsetHours(-2.2, 113.9)).toBe(7);    // Palangka Raya
    expect(utcOffsetHours(-3.3, 114.6)).toBe(8);    // Banjarmasin
    expect(utcOffsetHours(-5.15, 119.43)).toBe(8);  // Makassar
    expect(utcOffsetHours(-2.53, 140.7)).toBe(9);   // Jayapura
  });

  it('the endpoints no longer read the server clock for local hour, month or weekday', () => {
    for (const f of ['api/vayu/road-aqi.ts', 'api/vayu/route-score.ts', 'api/vayu/aqi.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/\.get(Hours|Month|Day)\(\)/);
    }
  });
});
