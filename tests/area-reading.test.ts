import { describe, expect, it } from 'vitest';
import { areaReadingFromManifest, FIELD_LAYER_SOURCE, tileOf } from '../src/lib/field/areaReading';
import { readFieldArea, regionOf } from '../src/lib/field/areaClient';
import type { FieldManifest } from '../src/lib/field/source';
import { pm25Category } from '../src/lib/ispu';

const denpasar = { lat: -8.6705, lng: 115.2126 };
const [tx, ty] = tileOf(denpasar);
const manifest: FieldManifest = {
  geometry: '2026-11', run: '2026111608', computed_at: '2026-11-16T08:04:00Z', valid_hour_local: 16, engine: 'v2.1', cells: [0, 1],
  cell_tiles: [[tx + 1, ty], [tx, ty]],
  cell_stats: { '0': { pm25_median: 20, no2_median: 9, roads: 10 }, '1': { pm25_median: 12.3, no2_median: 7, roads: 5000 } },
};

describe('area reading for the value card', () => {
  it('takes the median of the roads in the z12 cell under the map centre', () => {
    const r = areaReadingFromManifest(manifest, denpasar)!;
    expect(r.pm25).toBe(12.3);
    expect(r.no2).toBe(7);
    expect(r.layer_source).toBe(FIELD_LAYER_SOURCE);
    expect(r.timestamp).toBe(manifest.computed_at);
    expect(Number.isNaN(r.pm10)).toBe(true); // not in the field: shown as a dash, never invented
    expect(pm25Category(r.pm25).name).toBe('Baik');
  });

  it('returns null outside the cells of the manifest or for a manifest without statistics', () => {
    expect(areaReadingFromManifest(manifest, { lat: -6.2, lng: 106.8 })).toBeNull();
    expect(areaReadingFromManifest({ ...manifest, cell_stats: undefined }, denpasar)).toBeNull();
  });

  it('chooses the field only inside a field region and only with the flag on', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify(manifest)); }) as unknown as typeof fetch;
    expect(regionOf(denpasar)?.name).toBe('badung_denpasar');
    expect(regionOf({ lat: -6.2, lng: 106.8 })).toBeNull();
    expect(await readFieldArea(denpasar, f, false)).toBeNull();
    expect(await readFieldArea({ lat: -6.2, lng: 106.8 }, f, true)).toBeNull();
    const r = await readFieldArea(denpasar, f, true);
    expect(r?.pm25).toBe(12.3);
    expect(calls.every((c) => c.endsWith('/v/badung_denpasar/manifest.json') && !c.includes('/api/'))).toBe(true);
  });
});
