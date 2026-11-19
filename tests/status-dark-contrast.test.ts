import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W50: axe in dark mode found 'run 2026111914' on /status in text-gray-500 on gray-900 (contrast 3,66, needs 4,5).
// Every grey text on the status page that is fine in light mode must name its dark-mode colour too.
const SRC = readFileSync('src/pages/StatusPage.tsx', 'utf8');

describe('status page in dark mode', () => {
  it('gives every text-gray-500/600 class list a dark: text colour', () => {
    const lists = [...SRC.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2]);
    const grey = lists.filter((c) => /(^|\s)text-gray-(500|600)(\s|$)/.test(c));
    expect(grey.length).toBeGreaterThan(2);
    expect(grey.filter((c) => !/dark:text-/.test(c))).toEqual([]);
  });
});
