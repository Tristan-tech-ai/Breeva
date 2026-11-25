import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { berandaAngka, publishedLast24 } from '../src/lib/beranda';
import BerandaPage from '../src/pages/BerandaPage';

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
  it('shows one sentence, the three numbers and the three doors before any data arrives', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(BerandaPage)));
    expect(html).toContain('Asap kendaraan per ruas jalan, diperbarui tiap jam.');
    for (const t of ['Sensor warga', 'Titik api', 'Peta terbit']) expect(html).toContain(t);
    for (const href of ['href="/peta"', 'href="/prioritas"', 'href="/pantau"']) expect(html).toContain(href);
    expect(html).toContain('beranda-peta.webp');
  });
});
