import { describe, expect, it, vi } from 'vitest';
import { encodeExhaust } from '../src/lib/field/forecast';
import { roadSeries, sparkBlock, sparkSvg } from '../src/lib/field/roadSeries';

const m = {
  run: '2026112510', valid_hour_local: 18,
  forecast_runs: [
    { ahead: 1, valid: '2026112511', local_hour: 19, key: 'x2026112511.bin' },
    { ahead: 2, valid: '2026112512', local_hour: 20, key: 'x2026112512.bin' },
    { ahead: 13, valid: '2026112523', local_hour: 7, key: 'x2026112523.bin' },
  ],
};
const file = (v: number) => encodeExhaust([{ c: 4, values: [1, v, 3] }, { c: 9, values: [5] }]);

describe('N-04 tapped road: exhaust now and at the forecast hours', () => {
  it('reads the road (cell 4, index 1) from each forecast file, once per file, in hour order', async () => {
    const f = vi.fn(async (u: string) => new Response(file(u.includes('x2026112523') ? 40 : u.includes('x2026112511') ? 10 : 6) as BodyInit));
    const pts = await roadSeries('https://cdn', 'kota_bogor', m, 4, 1, 12, f as unknown as typeof fetch);
    expect(pts.map((p) => p.local_hour)).toEqual([18, 19, 20, 7]);
    expect(pts[0].value).toBe(12);
    expect(pts[3].value).toBeGreaterThan(pts[2].value); // 07.00 school rush is the highest
    expect(f.mock.calls.map((c) => c[0])).toContain('https://cdn/v/kota_bogor/2026112510/x2026112512.bin');
    await roadSeries('https://cdn', 'kota_bogor', m, 4, 2, 3, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(3); // decoded once per page
  });
  it('skips a forecast file that fails, and draws nothing from one point', async () => {
    const f = (async (u: string) => (u.includes('x2026112512') ? new Response(file(5) as BodyInit) : new Response('', { status: 404 }))) as unknown as typeof fetch;
    const pts = await roadSeries('https://cdn2', 'r', { ...m, run: '2026112511' }, 4, 1, 8, f);
    expect(pts.map((p) => p.ahead)).toEqual([0, 2]);
    expect(sparkSvg([pts[0]])).toBe('');
  });
  it('names the quietest hour when it is at least 10% below now', () => {
    const pts = [{ ahead: 0, local_hour: 18, value: 20 }, { ahead: 1, local_hour: 19, value: 15 }, { ahead: 13, local_hour: 7, value: 30 }];
    const b = sparkBlock(pts);
    expect(b).toContain('<svg');
    expect(b).toContain('paling sedikit asap pukul 19.00 (−25% dari sekarang)');
    expect(b).toContain('aria-label="Asap kendaraan jam ini dan jam berikutnya: tertinggi 07.00, terendah 19.00"');
    expect(sparkBlock([{ ahead: 0, local_hour: 3, value: 2 }, { ahead: 1, local_hour: 4, value: 1.95 }])).toContain('jam ini termasuk yang paling sedikit');
  });
});
