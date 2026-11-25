import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EpaBars from '../src/components/viz/EpaBars';
import { epaFlags, type Validasi } from '../src/lib/validasi';
import { dailySeries } from '../src/lib/field/validationRecent';

const v = JSON.parse(readFileSync('public/data/validasi.json', 'utf8')) as Validasi;
const titik = JSON.parse(readFileSync('public/data/validasi_titik.json', 'utf8')) as { n: number; per_hari: Record<string, number>; titik: Array<[number, number, string]> };

describe('N-05 /validasi charts', () => {
  it('each EPA card counts the same passes as the table rule and shows the four numbers', () => {
    for (const r of v.daily) {
      const html = renderToStaticMarkup(h(EpaBars, { title: r.label, values: r }));
      const passed = epaFlags(r, v.standard).passed;
      expect(html).toContain(`lolos ${passed} dari 4`);
      expect(html).toContain(`${r.nrmse_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
    }
  });
  it('a missing slope shows a dash and no pass', () => {
    const html = renderToStaticMarkup(h(EpaBars, { title: 't', values: { nrmse_pct: 20, r2: 0.8, slope: null, intercept: 1 } }));
    expect(html).toContain('—');
    expect(html).toContain('lolos 3 dari 4');
  });
  it('the scatter file holds daily pairs only, counted per day', () => {
    expect(titik.n).toBe(titik.titik.length);
    expect(Object.values(titik.per_hari).reduce((a, b) => a + b, 0)).toBe(titik.n);
    for (const [o, p, d] of titik.titik) { expect(o).toBeGreaterThan(0); expect(p).toBeGreaterThan(0); expect(d).toMatch(/^2026-11-\d\d$/); }
  });
  it('the daily line has one value per calendar day and gaps for days without a test', () => {
    const s = dailySeries([{ date: '2026-11-17', nrmse: 0.21 }, { date: '2026-11-19', nrmse: 0.18 }, { date: '2026-11-18', nrmse: 0.25 }, { date: '2026-11-21', nrmse: 0.3 }])!;
    expect(s.values).toEqual([21, 25, 18, null, 30]);
    expect([s.from, s.to]).toEqual(['2026-11-17', '2026-11-21']);
    expect(dailySeries([{ date: '2026-11-17', nrmse: 0.2 }])).toBeNull();
  });
});
