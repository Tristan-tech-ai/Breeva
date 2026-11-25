import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeLines, tileOf } from '../src/lib/nasional/mvt';

// a real z14 tile of the national road tiles (Jayapura) and tippecanoe-decode's reading of it (tippecanoe v2.82.0)
const bytes = new Uint8Array(readFileSync('tests/fixtures/jalan_14_14595_8307.mvt'));
const ref = JSON.parse(readFileSync('tests/fixtures/jalan_14_14595_8307.ref.json', 'utf8')) as { n: number; garis: number; kelas: Record<string, number>; first: { props: Record<string, number>; coords: number[][] } };

describe('N-21 vector tile decoder', () => {
  const f = decodeLines(bytes, 'jalan', 14, 14595, 8307);
  it('finds the same features, lines and classes as tippecanoe-decode', () => {
    expect(f).toHaveLength(ref.n);
    expect(f.reduce((a, x) => a + x.lines.length, 0)).toBe(ref.garis);
    const kelas: Record<string, number> = {};
    for (const x of f) kelas[String(x.props.k)] = (kelas[String(x.props.k)] ?? 0) + 1;
    expect(kelas).toEqual(ref.kelas);
  });
  it('gives the same coordinates (to 1e-5 degree) and properties for the first feature', () => {
    expect(f[0].props).toMatchObject(ref.first.props);
    f[0].lines[0].slice(0, 2).forEach(([lon, lat], i) => {
      expect(Math.abs(lon - ref.first.coords[i][0])).toBeLessThan(1e-5);
      expect(Math.abs(lat - ref.first.coords[i][1])).toBeLessThan(1e-5);
    });
  });
  it('ignores other layers and finds the tile of a point', () => {
    expect(decodeLines(bytes, 'lain', 14, 14595, 8307)).toEqual([]);
    expect(tileOf(140.7, -2.54, 14)).toEqual([14595, 8307]);
  });
});
