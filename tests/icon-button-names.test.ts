import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A button whose only child is an icon component needs an accessible name (axe button-name; X-W32, F1-67): the PWA
// install banner's close button failed axe on /home whenever the banner appeared.
// attributes may hold arrow functions (=>); the only child is one icon or a conditional pair of icons
const ICON_ONLY = /<button((?:=>|[^>])*?)>\s*(?:<([A-Z][A-Za-z0-9.]*)(?:=>|[^<>])*?\/>|\{[^{}<>]*\?\s*<([A-Z][A-Za-z0-9.]*)(?:=>|[^<>])*?\/>\s*:\s*<[A-Z][A-Za-z0-9.]*(?:=>|[^<>])*?\/>\s*\})\s*<\/button>/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

export function unnamedIconButtons(source: string): string[] {
  return [...source.matchAll(ICON_ONLY)].filter((m) => !/aria-label|title=/.test(m[1])).map((m) => m[2] ?? m[3]);
}

describe('icon-only buttons', () => {
  it('finds an unnamed icon button and accepts a labelled one', () => {
    expect(unnamedIconButtons('<button onClick={f} className="p-1">\n  <X size={16} />\n</button>')).toEqual(['X']);
    expect(unnamedIconButtons('<button aria-label="Tutup" onClick={f}><X size={16} /></button>')).toEqual([]);
    expect(unnamedIconButtons('<button onClick={f}><X size={16} /> Tutup</button>')).toEqual([]);
    expect(unnamedIconButtons('<button onClick={() => go(-1)}>\n  <ChevronLeft />\n</button>')).toEqual(['ChevronLeft']);
    expect(unnamedIconButtons('<button onClick={() => t(!s)}>{s ? <EyeOff /> : <Eye />}</button>')).toEqual(['EyeOff']);
    expect(unnamedIconButtons('<button aria-label={s ? "a" : "b"} onClick={() => t(!s)}>{s ? <EyeOff /> : <Eye />}</button>')).toEqual([]);
  });

  it('every icon-only button in src has an accessible name', () => {
    const bad = tsxFiles('src').flatMap((f) => unnamedIconButtons(readFileSync(f, 'utf8')).map((icon) => `${f}: <${icon}>`));
    expect(bad).toEqual([]);
  });
});
