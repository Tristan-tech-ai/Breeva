import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W67: in dark mode Leaflet's zoom buttons were white with black signs on the dark map. They follow dark mode now:
// the signs keep 4.5:1 on the button, and the button edge keeps 3:1 (WCAG 1.4.11) against the dark map behind it.
const CSS = readFileSync('src/index.css', 'utf8');

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: string, b: string) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('dark-mode zoom buttons', () => {
  const btn = /html\.dark \.leaflet-bar a,\s*html\.dark \.leaflet-bar a:hover,\s*html\.dark \.leaflet-bar a:focus \{\s*background-color: (#[0-9a-f]{6});\s*border-bottom-color: (#[0-9a-f]{6});\s*color: (#[0-9a-f]{6});/.exec(CSS);
  const hover = /html\.dark \.leaflet-bar a:hover \{\s*background-color: (#[0-9a-f]{6});/.exec(CSS);
  const edge = /html\.dark \.leaflet-bar \{\s*border-color: (#[0-9a-f]{6});/.exec(CSS);

  it('has dark rules for the bar, the buttons and hover', () => {
    expect(btn).not.toBeNull();
    expect(hover).not.toBeNull();
    expect(edge).not.toBeNull();
  });

  it('keeps the signs readable and the edge visible', () => {
    expect(contrast(btn![3], btn![1])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(btn![3], hover![1])).toBeGreaterThanOrEqual(4.5);
    for (const map of ['#1f1f1f', '#34373d']) expect(contrast(edge![1], map)).toBeGreaterThanOrEqual(3);
  });
});
