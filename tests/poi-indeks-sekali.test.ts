import { describe, expect, it, vi } from 'vitest';
import type { POI } from '../src/lib/poi-api';

// poi-icons builds Leaflet icons at import (needs window); the index only needs the two priority functions
vi.mock('../src/lib/poi-icons', () => ({
  resolvePriority: (types: string[]) => (types.includes('healthcare.hospital') ? 14 : 18),
  merchantPriority: () => 14,
}));
const { getVisibleFeatures, indexLoads, needsReindex, reindex } = await import('../src/lib/poi-cluster');
const resolvePriority = (types: string[]) => (types.includes('healthcare.hospital') ? 14 : 18);

const poi = (id: string, lng: number, lat: number, types: string[]): POI =>
  ({ id, name: id, category: types[0] ?? 'x', coordinate: { lat, lng }, types } as unknown as POI);

describe('N-67 POI index built once per POI set, tiers applied at query time', () => {
  const low = poi('rendah', 115.2, -8.65, []); // default tier 18: only at high zoom
  const pois = [low, ...Array.from({ length: 200 }, (_, i) => poi(`p${i}`, 115.2 + i * 1e-4, -8.65 + i * 1e-4, []))];
  it('crossing integer zoom levels does not rebuild the index', () => {
    const before = indexLoads();
    reindex(pois, 9001, true, false);
    for (const z of [14, 15, 16, 17, 18, 15.5, 14.2]) {
      if (needsReindex(9001, true, false)) reindex(pois, 9001, true, false);
      getVisibleFeatures(115.1, -8.7, 115.3, -8.6, z);
    }
    expect(indexLoads() - before).toBe(1);
    expect(needsReindex(9001, true, true)).toBe(true); // a filter toggle still rebuilds
    expect(needsReindex(9002, true, false)).toBe(true); // new POI data still rebuilds
  });
  it('a POI above the zoom tier stays hidden unless showAll, as before', () => {
    reindex(pois, 9003, true, false);
    const tier = resolvePriority([]);
    const ids = (z: number, all = false) => getVisibleFeatures(115.1, -8.7, 115.3, -8.6, z, all)
      .filter((f) => f.type === 'point').map((f) => (f as { id: string }).id);
    expect(ids(tier - 1)).not.toContain('rendah');
    expect(ids(tier - 1, true).length).toBeGreaterThan(0);
    expect(ids(tier).length).toBeGreaterThan(0);
  });
});

import { readFileSync } from 'node:fs';
describe('N-67 the index does one level of work and is built in idle time', () => {
  it('supercluster builds no cluster level at all (it is only queried above maxZoom)', () => {
    const s = readFileSync('src/lib/poi-cluster.ts', 'utf8');
    expect(s).toMatch(/minZoom: 21,\s*\n\s*maxZoom: 20,/);
  });
  it('POILayer builds the index in idle time when a POI pack arrives', () => {
    const s = readFileSync('src/components/map/POILayer.tsx', 'utf8');
    expect(s).toMatch(/requestIdleCallback\(\(\) => bangunIndeks\(ctxRef\.current\.greenOnly\)/);
    // N-73: the idle build starts only after the load window
    expect(s).toMatch(/export const TUNDA_INDEKS_MS = 8000;/);
    expect(s).toMatch(/window\.setTimeout\(\(\) => \{\s*idle = /);
    expect(s).toMatch(/\}, \[serial\]\);/);
  });
});
