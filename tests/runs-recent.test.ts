import { describe, expect, it } from 'vitest';
import { MAX_RUNS, mergeRuns, runsSummary, runsText, shiftRun, shortReason, type RunsFile } from '../src/lib/field/runsRecent';

const now = new Date('2026-11-18T03:00:00Z');

describe('builder runs per region (F2-23)', () => {
  it('keeps runs oldest first, replaces a run built again, and at most 48', () => {
    let f: RunsFile | null = null;
    for (let h = 0; h < 60; h++) f = mergeRuns(f, 'r', { run: shiftRun('2026111600', h), ok: true, seconds: 160 }, now);
    expect(f!.runs.length).toBe(MAX_RUNS);
    expect(f!.runs[0].run).toBe(shiftRun('2026111600', 12));
    f = mergeRuns(f, 'r', { run: f!.runs[5].run, ok: false, reason: 'x' }, now);
    expect(f.runs.length).toBe(MAX_RUNS);
    expect(f.runs[5]).toEqual({ run: shiftRun('2026111600', 17), ok: false, reason: 'x' });
  });

  it('a failed hour and a missing hour are named in the last 24 hours; hours before the file began are not missing', () => {
    let f: RunsFile | null = null;
    for (let h = 0; h < 30; h++) {
      const run = shiftRun('2026111700', h);
      if (run === '2026111717') f = mergeRuns(f, 'badung_denpasar', { run, ok: false, reason: 'fetch failed' }, now);
      else if (run !== '2026111721') f = mergeRuns(f, 'badung_denpasar', { run, ok: true }, now);
    }
    const s = runsSummary(f)!;
    expect(s.last).toBe('2026111805');
    expect(s.hours).toBe(24);
    expect(s.ok).toBe(22);
    expect(s.failed).toEqual([{ run: '2026111717', reason: 'fetch failed' }]);
    expect(s.missing).toEqual(['2026111721']);
    const fmt = (d: Date) => d.toISOString().slice(5, 13).replace('T', ' ') + 'Z';
    expect(runsText(s, fmt)).toBe('Dalam 24 jam terakhir: 22 dari 24 jam terbit. 11-17 17Z gagal (fetch failed); 11-17 21Z tidak tercatat.');
    const young = mergeRuns(null, 'r', { run: '2026111803', ok: true }, now);
    expect(runsSummary(young)).toMatchObject({ hours: 1, ok: 1, missing: [] });
    expect(runsText(runsSummary(young)!, fmt)).toBe('Dalam 1 jam terakhir: 1 dari 1 jam terbit.');
    expect(runsSummary(null)).toBeNull();
  });

  it('a reason is short and carries no query string', () => {
    expect(shortReason('fetch api.openaq.org: HTTP 500 at https://x.test/a?key=SECRET&b=1 after 4 tries')).toBe('fetch api.openaq.org: HTTP 500 at https://x.test/a after 4 tries');
    expect(shortReason('x'.repeat(300)).length).toBe(120);
    expect(shiftRun('2026113023', 1)).toBe('2026120100');
  });
});
