import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// X-W50: the offline toast said 'Offline mode ready' / 'App shell dan cache inti' (English, jargon) over the map.
// Toasts are plain Indonesian.
const SRC = readFileSync('src/lib/pwa.ts', 'utf8');
const texts = [...SRC.matchAll(/(?:title|message|actionLabel): '([^']*)'/g)].map((m) => m[1]);

describe('PWA toasts', () => {
  it('has the toast texts', () => {
    expect(texts.length).toBeGreaterThanOrEqual(5);
  });
  it('uses no English or developer words', () => {
    for (const t of texts) expect(t).not.toMatch(/\b(offline|mode|ready|app shell|cache|refresh|native)\b/i);
  });
});
