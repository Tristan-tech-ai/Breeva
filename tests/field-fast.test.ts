import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { cellsInView, FIELD_REGIONS, FieldSource, type Box } from '../src/lib/field/source';

const tileCalls: string[] = [];
vi.mock('pmtiles', () => ({
  PMTiles: class {
    constructor(public url: string) {}
    async getMetadata() { return { highway_codes: ['motorway'] }; }
    async getZxy(z: number, x: number, y: number) { tileCalls.push(`${z}/${x}/${y}`); await new Promise((r) => setTimeout(r, 5)); return { data: new ArrayBuffer(8) }; }
  },
}));

// cell_tiles of the real Badung-Denpasar manifest (run 2026111611): z12 tiles of the 11 cells
const tiles: Array<[number, number]> = [[3357, 2145], [3358, 2145], [3359, 2145], [3357, 2146], [3358, 2146], [3359, 2146], [3358, 2147], [3359, 2147], [3357, 2148], [3358, 2148], [3359, 2148]];
const m = { cells: tiles.map((_, k) => k), cell_tiles: tiles };
const cellBytes = readFileSync('tests/fixtures/cell_small.bin');

describe('first colored map (F1-13)', () => {
  it('finds the cells under a view box from their z12 tiles', () => {
    // lon 115.20 -> x 3358.7, 115.23 -> x 3359.1; lat -8.65 -> y 2146.8, -8.68 -> y 2147.1: tiles x 3358-3359, y 2146-2147
    const small: Box = [[-8.68, 115.2], [-8.65, 115.23]];
    expect(cellsInView(m, small)).toEqual([4, 5, 6, 7]);
    // well inside tile (3359, 2146): lat -8.667..-8.581, lon 115.225..115.312
    expect(cellsInView(m, [[-8.63, 115.25], [-8.62, 115.26]])).toEqual([5]);
    // the whole region covers every cell
    expect(cellsInView(m, FIELD_REGIONS[0].bounds).sort((a, b) => a - b)).toEqual(m.cells);
    expect(cellsInView({ cells: [0, 1] }, small)).toEqual([]);
  });

  it('init fetches the cells in view right after the manifest, and never the harga file', async () => {
    const calls: string[] = [];
    const manifest = { geometry: '2026-11', run: '2026111611', computed_at: '2026-11-16T11:06:21Z', valid_hour_local: 19, engine: 'v2.1', cells: m.cells, cell_tiles: tiles };
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
      if (/\/\d+\.bin$/.test(String(url)) && String(url).includes('/v/')) return new Response(cellBytes);
      return new Response('x', { status: 404 });
    }) as unknown as typeof fetch;
    const src = new FieldSource(FIELD_REGIONS[0], '/field', fetchImpl);
    await src.init([[-8.68, 115.2], [-8.65, 115.23]]);
    expect(calls).toEqual(['/field/v/badung_denpasar/manifest.json', ...[4, 5, 6, 7].map((c) => `/field/v/badung_denpasar/2026111611/${c}.bin`)]);
    await src.ensureHarga();
    await src.ensureHarga();
    expect(calls.filter((c) => c.includes('/harga/'))).toHaveLength(1);
  });

  it('fetches each native tile once for all its overzoomed children and later redraws', async () => {
    const src = new FieldSource(FIELD_REGIONS[0], '/field', (async () => new Response('x', { status: 404 })) as unknown as typeof fetch);
    tileCalls.length = 0;
    // four z15 children of one z14 tile asked at the same time, then a redraw asking again
    const first = await Promise.all([0, 1, 2, 3].map(() => src.tile(14, 13436, 8586)));
    await src.tile(14, 13436, 8586);
    await src.tile(14, 13437, 8586);
    expect(first.every((r) => r?.data.byteLength === 8)).toBe(true);
    expect(tileCalls).toEqual(['14/13436/8586', '14/13437/8586']);
  });
});
