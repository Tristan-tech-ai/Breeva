import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W57: in dark mode the map attribution was a light grey box on the dark map; it is now dark, and its text and links
// must keep WCAG AA contrast (4.5:1) over the dark map colours behind the semi-transparent box.
const CSS = readFileSync('src/index.css', 'utf8');

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (rgb: number[], alpha: number, under: number[]) => rgb.map((v, i) => Math.round(alpha * v + (1 - alpha) * under[i]));

describe('dark-mode map attribution', () => {
  const box = /html\.dark \.leaflet-container \.leaflet-control-attribution \{\s*background: rgba\((\d+), (\d+), (\d+), ([\d.]+)\);\s*color: (#[0-9a-f]{6});/.exec(CSS);
  const link = /html\.dark \.leaflet-container \.leaflet-control-attribution a \{\s*color: (#[0-9a-f]{6});/.exec(CSS);

  it('has a dark box and its own text and link colours', () => {
    expect(box).not.toBeNull();
    expect(link).not.toBeNull();
  });

  it('keeps 4.5:1 for text and links over the dark basemap colours (land #1f1f1f, water #34373d, roads #2b3442)', () => {
    const bg = [Number(box![1]), Number(box![2]), Number(box![3])];
    const alpha = Number(box![4]);
    for (const under of ['#1f1f1f', '#34373d', '#2b3442'].map(hex)) {
      const b = over(bg, alpha, under);
      expect(contrast(hex(box![5]), b)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(link![1]), b)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
