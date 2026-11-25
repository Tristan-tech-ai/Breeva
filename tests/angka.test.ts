import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatAngka } from '../src/lib/angka';
import { fmt } from '../src/lib/prioritas';

describe('N-42 cached Indonesian number formatting', () => {
  it('formats like toLocaleString id-ID with the same digits', () => {
    for (const [x, a, b] of [[1234.5678, 1, 1], [0.04, 0, 0], [16, 0, 3], [1234567.891, 2, 2], [-3.25, 1, 1]] as const) {
      expect(formatAngka(x, a, b)).toBe(x.toLocaleString('id-ID', { minimumFractionDigits: a, maximumFractionDigits: b }));
    }
    expect(fmt(26.84)).toBe('26,8');
    expect(fmt(1493, 0)).toBe('1.493');
  });
  it('the monitoring map makes tooltip texts on hover and adds the kab/kota polygons after the first paint', () => {
    const src = readFileSync('src/components/pantau/PantauMap.tsx', 'utf8');
    expect(src).toContain('bindTooltip(() => teksApi(f, luar))');
    expect(src).toContain('g.bindTooltip((l) =>');
    expect(src).toContain('sesudahLukis(langkah)');
    expect(src).not.toMatch(/toLocaleString\(/);
  });
});

describe('N-42 priority list first paint', () => {
  it('renders a short first screen, then the page size', async () => {
    const { LANGSUNG_PERTAMA, PAGE_SIZE } = await import('../src/lib/prioritas');
    expect(LANGSUNG_PERTAMA).toBeLessThan(PAGE_SIZE);
    const src = readFileSync('src/pages/PrioritasPage.tsx', 'utf8');
    expect(src).toContain('lukisPenuh ? shown : Math.min(shown, LANGSUNG_PERTAMA)');
  });
});
