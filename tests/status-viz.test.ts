import { describe, expect, it } from 'vitest';
import { runsStrip, runsSummary, shiftRun, type RunsFile } from '../src/lib/field/runsRecent';
import { sensorSeries } from '../src/lib/field/validationRecent';

const last = '2026112510';
/** runs for the hours `back` = 0..startBack-1 before `last`, leaving out `skip`, failing `fail` (both in hours back). */
const file = (skip: number[], fail: number[], startBack = 30): RunsFile => ({
  format: 'runs_recent', name: 'x', updated_at: '',
  runs: Array.from({ length: startBack }, (_, back) => back).filter((back) => !skip.includes(back))
    .map((back) => ({ run: shiftRun(last, -back), ok: !fail.includes(back) })),
});

describe('N-07 /status: hour strip and sensors per hour', () => {
  it('the strip has 24 hours oldest first and as many published hours as the summary line', () => {
    for (const f of [file([], []), file([3, 7], [1]), file([], [], 10)]) {
      const s = runsStrip(f)!;
      expect(s).toHaveLength(24);
      expect(s[23].run).toBe(last);
      const sum = runsSummary(f)!;
      expect(s.filter((x) => x.state === 'ok').length).toBe(sum.ok);
      expect(s.filter((x) => x.state === 'gagal').length).toBe(sum.failed.length);
      expect(s.filter((x) => x.state === 'hilang').length).toBe(sum.missing.length);
    }
    expect(runsStrip(file([], [], 10))!.filter((x) => x.state === 'sebelum')).toHaveLength(14);
    expect(runsStrip(null)).toBeNull();
  });
  it('sensors per hour line up with the run hours and leave gaps where no run tested', () => {
    const v = sensorSeries({ entries: [{ run: last, n: 22 }, { run: shiftRun(last, -2), n: 19 }] as never }, last, 4);
    expect(v).toEqual([null, 19, null, 22]);
  });
});
