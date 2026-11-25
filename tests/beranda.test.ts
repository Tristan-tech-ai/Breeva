import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { berandaAngka, publishedLast24 } from '../src/lib/beranda';
import LandingPage from '../src/pages/LandingPage';

const now = new Date('2026-11-25T10:30:00Z');
const runs = (n: number, failAt: number[] = []) => ({ runs: Array.from({ length: n }, (_, i) => {
  const t = new Date(now.getTime() - (i + 1) * 3_600_000);
  const id = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}${String(t.getUTCHours()).padStart(2, '0')}`;
  return { run: id, ok: !failAt.includes(i) };
}) });

describe('landing at / (N-02)', () => {
  it('counts only published runs of the last 24 hours', () => {
    expect(publishedLast24(runs(30), now)).toBe(24);
    expect(publishedLast24(runs(30, [0, 5]), now)).toBe(22);
    expect(publishedLast24(null, now)).toBeNull();
  });
  it('sums sensors, takes the weakest region and the national fire count', () => {
    expect(berandaAngka([{ sensors_used: 23 }, { sensors_used: 0 }], [runs(24), runs(24, [3])], { n: 1385 }, now)).toEqual({ sensor: 23, titikApi: 1385, jamTerbit: 23 });
    expect(berandaAngka([null], [null], null, now)).toEqual({ sensor: null, titikApi: null, jamTerbit: null });
  });
  it('the 3D landing carries the real numbers, the three doors and no invented route example', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(LandingPage)));
    for (const t of ['sensor warga aktif', 'titik api, 24 jam', 'jam peta terbit', '90,7%', '−66% asap', 'Satu Peta']) expect(html).toContain(t);
    for (const href of ['href="/peta"', 'href="/prioritas"', 'href="/pantau"', 'href="/pemerintah"']) expect(html).toContain(href);
    for (const gone of ['AQI 142', 'rokok', 'Tanya Vayu', '8 kota', 'twitter.com']) expect(html).not.toContain(gone);
  });
});
