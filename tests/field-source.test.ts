import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ageLabel, FIELD_REGIONS, FieldSource, overzoomPoints } from '../src/lib/field/source';
import { fieldColor } from '../src/lib/field/color';
import type { CellValue } from '../src/lib/field/cells';

vi.mock('pmtiles', () => ({
  PMTiles: class {
    constructor(public url: string) {}
    async getMetadata() { return { highway_codes: ['motorway', 'trunk', 'primary'] }; }
  },
}));

const cellBytes = readFileSync('tests/fixtures/cell_small.bin');
const manifest = { geometry: '2026-11', run: '2026111607', computed_at: '2026-11-16T07:04:00Z', valid_hour_local: 15, engine: 'v2.1', cells: [3] };

function fakeFetch(calls: string[]) {
  return (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    if (String(url).endsWith('/3.bin')) return new Response(cellBytes);
    return new Response('missing', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('static field source', () => {
  it('reads the manifest, then loads a cell once on first use and serves values from it', async () => {
    const calls: string[] = [];
    const src = new FieldSource(FIELD_REGIONS[0], '/field', fakeFetch(calls));
    await src.init();
    expect(src.highway(1)).toBe('trunk');
    expect(src.value(3, 0)).toBeUndefined();     // starts the load
    await src.loadCell(3);
    expect(src.value(3, 0)?.pm25).toBeCloseTo(12.3, 1);
    expect(src.value(3, 2)?.ood).toBe(true);
    src.value(3, 1);
    expect(calls.filter((c) => c.endsWith('/3.bin'))).toHaveLength(1);
    expect(calls.every((c) => !c.includes('/api/'))).toBe(true);
  });

  it('never fetches a cell the manifest does not list', async () => {
    const calls: string[] = [];
    const src = new FieldSource(FIELD_REGIONS[0], '/field', fakeFetch(calls));
    await src.init();
    src.value(9, 0);
    await src.loadCell(9);
    expect(calls.some((c) => c.endsWith('/9.bin'))).toBe(false);
  });

  it('refuses a manifest for another geometry version', async () => {
    const src = new FieldSource({ ...FIELD_REGIONS[0], geometry: '2026-12' }, '/field', fakeFetch([]));
    await expect(src.init()).rejects.toThrow(/geometry/);
  });

  it('marks data older than three hours as stale', async () => {
    const src = new FieldSource(FIELD_REGIONS[0], '/field', fakeFetch([]));
    await src.init();
    const t = Date.parse(manifest.computed_at);
    expect(src.isStale(t + 2 * 3_600_000)).toBe(false);
    expect(src.isStale(t + 4 * 3_600_000)).toBe(true);
    expect(ageLabel(0.5)).toBe('30 menit lalu');
  });
});

describe('overzoom and colours', () => {
  it('maps a z14 tile point into the frame of its z16 child', () => {
    // child (x=5, y=6) of z14 parent (1, 1): offsets 1 and 2 tile widths after scaling by 4
    const out = overzoomPoints([[{ x: 1024, y: 2048 }]], 4096, { x: 5, y: 6, z: 16 });
    expect(out[0][0]).toEqual({ x: 1024 * 4 - 1 * 4096, y: 2048 * 4 - 2 * 4096 });
    expect(overzoomPoints([[{ x: 1, y: 2 }]], 4096, { x: 1, y: 1, z: 14 })[0][0]).toEqual({ x: 1, y: 2 });
  });

  it('colours by PM2.5, NO2 and the traffic part, grey outside calibration', () => {
    const v: CellValue = { pm25: 40, pm25_delta: 3, no2: 30, no2_delta: 12, confidence: 'high', ood: false, pi_half: 20 };
    expect(fieldColor(v, 'aqi', 'total')).not.toBe(fieldColor({ ...v, pm25: 5 }, 'aqi', 'total'));
    expect(fieldColor(v, 'pm25', 'traffic')).not.toBe(fieldColor({ ...v, pm25_delta: 0 }, 'pm25', 'traffic'));
    expect(fieldColor({ ...v, ood: true }, 'pm25', 'total')).toBe('#9ca3af');
  });
});
