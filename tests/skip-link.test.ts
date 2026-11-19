import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W112: the skip link is the first thing a keyboard user meets; the site is in Indonesian, so is the link.
const SRC = readFileSync('src/App.tsx', 'utf8');

describe('skip link', () => {
  it('points at the main content and speaks Indonesian', () => {
    const m = SRC.match(/<a href="#main-content"[^>]*>\s*([^<]+?)\s*<\/a>/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('Lewati ke konten utama');
    expect(SRC).not.toMatch(/Skip to main content/);
  });
});
