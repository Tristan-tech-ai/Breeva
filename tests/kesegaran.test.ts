import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BERKAS_NASIONAL, kesegaran, umurTeks } from '../src/lib/nasional/kesegaran';
import DataNasional from '../src/components/status/DataNasional';

const now = Date.parse('2026-11-25T16:30:00Z');

describe('N-48 freshness of the national files on /status', () => {
  it('fresh within the limit, delayed after it, missing without a time', () => {
    expect(kesegaran('2026-11-25T15:23:49Z', now, 120)).toEqual({ umurMenit: 66, status: 'segar' });
    expect(kesegaran('2026-11-25T13:20:00Z', now, 120)).toEqual({ umurMenit: 190, status: 'tertunda' });
    expect(kesegaran('2026-11-25T15:20:00Z', now, 60).status).toBe('tertunda'); // cameras: 70 min is late
    expect(kesegaran(null, now, 60)).toEqual({ umurMenit: null, status: 'tidak ada' });
    expect(kesegaran('bukan tanggal', now, 60).status).toBe('tidak ada');
  });
  it('ages read in Indonesian', () => {
    expect(umurTeks(0)).toBe('baru saja');
    expect(umurTeks(66)).toBe('66 menit lalu');
    expect(umurTeks(190)).toBe('3 jam lalu');
    expect(umurTeks(3000)).toBe('2 hari lalu');
    expect(umurTeks(null)).toBe('belum terbaca');
  });
  it('lists every national file once, cameras with the trial label and a 1-hour limit', () => {
    expect(new Set(BERKAS_NASIONAL.map((b) => b.path)).size).toBe(BERKAS_NASIONAL.length);
    const cam = BERKAS_NASIONAL.find((b) => b.kunci === 'cctv')!;
    expect(cam.batasMenit).toBe(60);
    expect(cam.catatan).toMatch(/uji coba selama lomba/);
    const html = renderToStaticMarkup(h(DataNasional, { base: '/x', now, awal: { latar: '2026-11-25T15:23:49Z', cctv: '2026-11-25T15:00:00Z', api: null } }));
    expect(html).toContain('Segar · 66 menit lalu');
    expect(html).toContain('Tertunda · 90 menit lalu');
    expect(html).toContain('Tidak terbaca · belum terbaca');
    expect(html).toContain('memuat…');
  });
});
