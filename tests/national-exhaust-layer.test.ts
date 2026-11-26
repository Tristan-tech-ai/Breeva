import { describe, expect, it } from 'vitest';
import { inPilot, ubinLuarPandang, viewTiles } from '../src/lib/nasional/ubinView';
import { tileOf } from '../src/lib/nasional/mvt';

describe('N-21 national exhaust layer', () => {
  it('lists the z14 tiles of the view, the centre first, at most 30', () => {
    const t = viewTiles({ west: 119.40, south: -5.17, east: 119.46, north: -5.11 }, { lon: 119.43, lat: -5.14 });
    expect(t[0]).toEqual([14, ...tileOf(119.43, -5.14, 14)]);
    expect(t.length).toBeGreaterThan(4);
    expect(t.length).toBeLessThanOrEqual(30);
    expect(viewTiles({ west: 110, south: -8, east: 112, north: -6 }, { lon: 111, lat: -7 })).toHaveLength(30);
  });
  it('leaves the pilot regions to the cloud field', () => {
    expect(inPilot(-8.67, 115.21)).toBe(true); // Denpasar
    expect(inPilot(-6.59, 106.80)).toBe(true); // Kota Bogor
    expect(inPilot(-5.14, 119.43)).toBe(false); // Makassar
  });
  it('M-U02: drops drawn tiles that left the view, keeps the rest', () => {
    const drawn = ['14/1/1@h', '14/1/2@h', '14/9/9@h'];
    expect(ubinLuarPandang(drawn, new Set(['14/1/1@h', '14/1/2@h']))).toEqual(['14/9/9@h']);
    expect(ubinLuarPandang(drawn, new Set())).toEqual(drawn);
    expect(ubinLuarPandang([], new Set(['14/1/1@h']))).toEqual([]);
    // a new hour makes every tile of the old hour stale
    expect(ubinLuarPandang(['14/1/1@h'], new Set(['14/1/1@h2']))).toEqual(['14/1/1@h']);
  });
});
