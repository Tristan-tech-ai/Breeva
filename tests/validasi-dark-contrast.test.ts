import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W110: axe in dark mode (setting breeva_dark_mode) found 26 nodes on /validasi in text-gray-500 on the dark table
// (color-contrast). Every grey text on the validation page that is fine in light mode must name its dark-mode colour too.
// the page and the two components it renders (the second axe pass found their captions, table head and source links)
const SRC = ['src/pages/ValidasiPage.tsx', 'src/components/features/ExhaustExplainer.tsx', 'src/components/features/RunningValidation.tsx']
  .map((f) => readFileSync(f, 'utf8')).join('\n');

describe('validation page in dark mode', () => {
  it('gives every text-gray-500/600 class list a dark: text colour', () => {
    const lists = [...SRC.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]);
    const grey = lists.filter((c) => /(^|\s)text-gray-(500|600)(\s|$)/.test(c));
    expect(grey.length).toBeGreaterThan(5);
    expect(grey.filter((c) => !/dark:text-/.test(c))).toEqual([]);
  });
});
