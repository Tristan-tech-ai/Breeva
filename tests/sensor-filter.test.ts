import { describe, expect, it } from 'vitest';
import { s1Filter, s1Keep } from '../scripts/field/sensor-filter';

// five sensors about 1-3 km apart around Denpasar
const at = (k: number, pm25: number) => ({ lat: -8.65 + 0.01 * (k % 3), lon: 115.2 + 0.012 * Math.floor(k / 3), pm25 });

describe('rule S1 for implausible sensor readings', () => {
  it('keeps a normal hour untouched', () => {
    expect(s1Keep([at(0, 20), at(1, 25), at(2, 30), at(3, 22), at(4, 27)])).toEqual([true, true, true, true, true]);
  });

  it('drops a reading below 1 and one five times off its neighbours', () => {
    const rs = [at(0, 0.3), at(1, 25), at(2, 160), at(3, 22), at(4, 27)];
    expect(s1Keep(rs)).toEqual([false, true, false, true, true]);
    expect(s1Filter(rs).map((r) => r.pm25)).toEqual([25, 22, 27]);
  });

  it('does not judge against a clean background (median below 5) or with fewer than 3 neighbours', () => {
    expect(s1Keep([at(0, 20), at(1, 3), at(2, 2), at(3, 4)])).toEqual([true, true, true, true]);
    expect(s1Keep([at(0, 200), at(1, 20), at(2, 22)])).toEqual([true, true, true]);
  });

  it('a factor of exactly 5 is kept (the rule drops only beyond it)', () => {
    const rs = [at(0, 100), at(1, 20), at(2, 20), at(3, 20)];
    expect(s1Keep(rs)[0]).toBe(true);
  });
});
