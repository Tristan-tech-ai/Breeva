import { describe, expect, it, vi } from 'vitest';
import { FIELD_REGIONS, FieldSource } from '../src/lib/field/source';

// F1-54: on slow 3G every wait in a row costs about 2 s. The archive metadata does not depend on the manifest, so it is
// asked for at the same time, and init does not wait for it (the highway codes only set line widths).
const order: string[] = [];
let releaseMeta: (v: unknown) => void = () => {};
let failMeta: (e: Error) => void = () => {};
vi.mock('pmtiles', () => ({
  PMTiles: class {
    constructor(public url: string) {}
    getMetadata() { order.push('metadata'); return new Promise((r, j) => { releaseMeta = r; failMeta = j; }); }
    async getZxy() { return undefined; }
  },
}));

const manifest = { geometry: '2026-11', run: '2026111800', computed_at: '2026-11-18T00:06:00Z', valid_hour_local: 8, engine: 'v2.1', cells: [] };

describe('FieldSource.init (F1-54)', () => {
  it('asks for the archive metadata before the manifest has arrived and does not wait for it', async () => {
    order.length = 0;
    let answer: () => void = () => {};
    const fetchImpl = ((url: string) => {
      order.push(`fetch ${String(url).split('/').pop()}`);
      return new Promise<Response>((r) => { answer = () => r(new Response(JSON.stringify(manifest))); });
    }) as unknown as typeof fetch;
    const src = new FieldSource(FIELD_REGIONS[0], '/f54a', fetchImpl);
    let done = false;
    const p = src.init().then(() => { done = true; });
    await Promise.resolve();
    expect(order).toEqual(['metadata', 'fetch manifest.json']); // both in flight together
    answer();
    await p;
    expect(done).toBe(true); // metadata still pending
    expect(src.highway(0)).toBe('other');
    const redraw = vi.fn();
    src.onCell = redraw;
    releaseMeta({ highway_codes: ['primary'] });
    await src.metaReady;
    expect(src.highway(0)).toBe('primary');
    expect(redraw).toHaveBeenCalledTimes(1); // the layer redraws with the real line widths
  });

  it('a failed metadata request leaves the map usable', async () => {
    const src = new FieldSource(FIELD_REGIONS[0], '/f54b', (async () => new Response(JSON.stringify(manifest))) as unknown as typeof fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = src.init();
    await p;
    failMeta(new Error('range request failed'));
    await src.metaReady; // settles instead of rejecting
    expect(src.highway(0)).toBe('other');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
