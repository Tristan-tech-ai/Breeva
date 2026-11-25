import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeLines, decodeTileLines, type MvtTileLine } from '../src/lib/nasional/mvt';
import { gambarUbin, kelompokGaya, letakUbin, type Kanvas2D } from '../src/lib/field/gambarRuas';

const bytes = new Uint8Array(readFileSync('tests/fixtures/jalan_14_14595_8307.mvt'));

function perekam() {
  const ops: string[] = [];
  const ctx: Kanvas2D & { ops: string[] } = {
    ops, strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
    setTransform: (...a: number[]) => { ops.push(`T ${a.join(',')}`); },
    clearRect: () => { ops.push('clear'); },
    beginPath: () => { ops.push('begin'); },
    moveTo: (x: number, y: number) => { ops.push(`M ${x},${y}`); },
    lineTo: (x: number, y: number) => { ops.push(`L ${x},${y}`); },
    stroke: () => { ops.push(`S ${String(ctx.strokeStyle)} ${ctx.lineWidth} ${ctx.globalAlpha}`); },
  };
  return ctx;
}

describe('N-41 coloured roads drawn without VectorGrid', () => {
  it('decodes the same roads as the lon/lat decoder, in tile units with a bounding box', () => {
    const t = decodeTileLines(bytes, 'jalan');
    const ll = decodeLines(bytes, 'jalan', 14, 14595, 8307);
    expect(t.features.length).toBe(ll.length);
    expect(t.features.length).toBeGreaterThan(10);
    const f = t.features[0];
    expect(f.props).toEqual(ll[0].props);
    expect(f.rings.length).toBe(ll[0].lines.length);
    // first point: tile units -> lon/lat matches the other decoder
    const p = f.rings[0][0], size = t.extent * 2 ** 14;
    expect(((14595 * t.extent + p.x) / size) * 360 - 180).toBeCloseTo(ll[0].lines[0][0][0], 9);
    const xs = f.rings.flat().map((q) => q.x), ys = f.rings.flat().map((q) => q.y);
    expect(f.bbox).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    expect(decodeTileLines(bytes, 'tidak-ada').features).toEqual([]);
  });

  it('places an overzoomed child tile inside its native tile', () => {
    expect(letakUbin({ z: 14, x: 10, y: 20 }, 14, 4096, 256)).toMatchObject({ native: { z: 14, x: 10, y: 20 }, s: 256 / 4096, ox: 0, oy: 0 });
    const l = letakUbin({ z: 16, x: 43, y: 81 }, 14, 4096, 256); // native 14/10/20, child (3,1) of 4x4
    expect(l.native).toEqual({ z: 14, x: 10, y: 20 });
    expect(l.s).toBe(1024 / 4096);
    expect([l.ox, l.oy]).toEqual([768, 256]);
    expect(l.box).toEqual([3072, 1024, 4096, 2048]);
  });

  const f = (x0: number, x1: number, props: Record<string, number>): MvtTileLine => ({ props, rings: [[{ x: x0, y: 10 }, { x: x1, y: 10 }]], bbox: [x0, 10, x1, 10] });

  it('groups roads by style, thin first, and skips roads outside the tile or without style', () => {
    const feats = [f(0, 100, { w: 6 }), f(50, 60, { w: 2 }), f(200, 300, { w: 2 }), f(5000, 6000, { w: 2 }), f(10, 20, { w: 0 })];
    const groups = kelompokGaya(feats, (p) => (p.w ? { color: p.w > 4 ? '#f00' : '#0f0', weight: Number(p.w), opacity: 0.9 } : null), [0, 0, 4096, 4096], 4);
    expect(groups.map((g) => [g.gaya.color, g.feats.length])).toEqual([['#0f0', 2], ['#f00', 1]]);
  });

  it('strokes each style once, scaled to the child tile, at the pixel ratio', () => {
    const ctx = perekam();
    const tile = { extent: 4096, features: [f(0, 4096, { w: 2 }), f(0, 2048, { w: 2 }), f(0, 4096, { w: 5 })] };
    const n = gambarUbin(ctx, tile, { z: 14, x: 0, y: 0 }, (p) => ({ color: p.w === 5 ? 'merah' : 'hijau', weight: Number(p.w), opacity: 0.8 }), { maxNative: 14, tileSize: 256, dpr: 2 });
    expect(n).toBe(3);
    expect(ctx.ops[0]).toBe('T 2,0,0,2,0,0');
    expect(ctx.ops.filter((o) => o.startsWith('S '))).toEqual(['S hijau 2 0.8', 'S merah 5 0.8']);
    expect(ctx.ops).toContain('L 256,0.625'); // x 4096 -> 256 px, y 10 -> 0.625 px
    expect(ctx.globalAlpha).toBe(1);
  });

  it('FieldLayer no longer loads VectorGrid and draws through gambarUbin', () => {
    const src = readFileSync('src/components/map/FieldLayer.ts', 'utf8');
    expect(src).not.toMatch(/ensureVectorGrid|VectorGrid\.Protobuf|vectorTileLayerStyles/);
    expect(src).toContain('gambarUbin(ctx, t, coords');
    expect(src).toContain('decodeTileLines(');
  });
});
