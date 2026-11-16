import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('POI requests stay inside the proxy limit', () => {
  it('every limit the client asks Geoapify for is 1..100, which api/searchapi/_params.ts accepts', () => {
    const src = readFileSync('src/lib/poi-api.ts', 'utf8');
    const limits = [...src.matchAll(/limit\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(limits.length).toBeGreaterThan(0);
    for (const n of limits) expect(n >= 1 && n <= 100).toBe(true);
    expect(readFileSync('api/searchapi/_params.ts', 'utf8')).toMatch(/Number\(limit\) <= 100/);
  });
});
