import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('N-63 sticky headers do not let the page text show through', () => {
  it('.glass-nav is at least 95% opaque in both themes', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const light = css.match(/\.glass-nav \{[^}]*background: rgba\(255, 255, 255, ([\d.]+)\)/);
    const dark = css.match(/\.dark \.glass-nav \{[^}]*background: rgba\(15, 23, 42, ([\d.]+)\)/);
    expect(Number(light?.[1])).toBeGreaterThanOrEqual(0.95);
    expect(Number(dark?.[1])).toBeGreaterThanOrEqual(0.95);
  });
});
