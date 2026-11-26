import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('N-53 route cards at 320 px and chip contrast', () => {
  const s = readFileSync('src/components/map/WalkRouteCards.tsx', 'utf8');
  it('the card grid has one shrinkable column on phones (cards were 299 px in a 244 px column at 320 px)', () => {
    expect(s).toMatch(/className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"/);
    expect(s).toMatch(/className="min-w-0 rounded-xl border[^"]*" data-route-card=\{k\}/);
  });
  it('white text sits on a dark enough chip (emerald-600 and rose-600 failed axe at text-sm)', () => {
    expect(s).not.toMatch(/'bg-emerald-600 text-white'|'bg-rose-600 text-white'/);
    expect(s).toMatch(/good: 'bg-emerald-700 text-white'/);
  });
});
