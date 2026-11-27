import { describe, expect, it } from 'vitest';
import { bangunGraf, simpulTerdekat, type UbinRuas } from '../src/lib/nasional/grafNasional';
import { route } from '../src/lib/route/router';
import type { WalkGraph } from '../src/lib/route/walkGraph';

// one tile from roads given as [class, nox, [lon, lat], [lon, lat], ...]
function ubin(...ruas: Array<[number, number, ...Array<[number, number]>]>): UbinRuas {
  const coords: number[] = [], offs: number[] = [0], nox: number[] = [], k: number[] = [];
  for (const [kelas, x, ...pts] of ruas) { for (const [lo, la] of pts) coords.push(lo, la); offs.push(coords.length / 2); nox.push(x); k.push(kelas); }
  return { coords: Float32Array.from(coords), offs: Uint32Array.from(offs), nox: Float32Array.from(nox), k: Uint8Array.from(k) };
}
const L0 = 115.2, B0 = -8.6, D = 0.001; // about 110 m
const jalan = (g: ReturnType<typeof bangunGraf>, a: [number, number], b: [number, number]) => {
  const s = simpulTerdekat(g, a[1], a[0]), t = simpulTerdekat(g, b[1], b[0]);
  return s >= 0 && t >= 0 ? route(g as unknown as WalkGraph, s, t, 0, { speed: 1.3 }) : null;
};

describe('walking graph from the national road tiles (T9)', () => {
  it('joins a shared vertex that two tiles place slightly apart, and keeps one copy of a repeated road', () => {
    // tile A: an east-west road through (L0+D, B0); tile B (buffer): the same road again, 0.4 m off, and a north-south road
    const a = ubin([5, 2, [L0, B0], [L0 + D, B0], [L0 + 2 * D, B0]]);
    const b = ubin([5, 2, [L0, B0 + 0.0000036], [L0 + D, B0 + 0.0000036], [L0 + 2 * D, B0 + 0.0000036]], [7, 1, [L0 + D, B0 - D], [L0 + D, B0 + 0.0000036], [L0 + D, B0 + D]]);
    const g = bangunGraf([a, b]);
    expect(g.n).toBe(5); // 3 on the east-west road + 2 ends of the north-south one
    expect(g.m).toBe(8); // 4 undirected segments, once each
    expect(jalan(g, [L0, B0], [L0 + D, B0 + D])?.lengthM).toBeCloseTo(110 + 111, -1);
  });

  it('joins a road that stops 3 m short of another (T-junction) and splits roads that cross without a shared vertex', () => {
    const t = ubin([5, 2, [L0, B0], [L0 + 2 * D, B0]], [7, 1, [L0 + D, B0 + D], [L0 + D, B0 + 0.000027]]); // ends 3 m north of the road
    const g = bangunGraf([t]);
    expect(jalan(g, [L0, B0], [L0 + D, B0 + D])?.lengthM).toBeLessThan(250);
    const x = ubin([5, 2, [L0, B0], [L0 + 2 * D, B0]], [7, 1, [L0 + D, B0 - D], [L0 + D, B0 + D]]); // a + without a vertex
    expect(jalan(bangunGraf([x]), [L0, B0], [L0 + D, B0 + D])?.lengthM).toBeCloseTo(110 + 110, -1);
    expect(jalan(bangunGraf([x], { silang: false }), [L0, B0], [L0 + D, B0 + D])).toBeNull();
  });

  it('a trunk road crossing is not joined (bridges are common there), and motorways are left out', () => {
    const x = ubin([2, 20, [L0, B0], [L0 + 2 * D, B0]], [7, 1, [L0 + D, B0 - D], [L0 + D, B0 + D]]);
    expect(jalan(bangunGraf([x]), [L0, B0], [L0 + D, B0 + D])).toBeNull();
    const tol = bangunGraf([ubin([1, 50, [L0, B0], [L0 + D, B0]], [7, 1, [L0, B0 + D], [L0 + D, B0 + D]])]);
    expect(tol.n).toBe(2);
  });

  it('every directed edge carries its road exhaust and class; a point snaps to the big network, not a fragment', () => {
    const lurus = Array.from({ length: 9 }, (_, i) => [L0 + (i * D) / 8, B0] as [number, number]); // 9 vertices
    const t = ubin([3, 12.5, ...lurus], [7, 0.5, [L0 + D, B0], [L0 + D, B0 + D]], [7, 0.5, [L0 + 3 * D, B0], [L0 + 3 * D + 0.0002, B0]]);
    const g = bangunGraf([t]);
    const e = Array.from({ length: g.m }, (_, i) => i).find((i) => g.kelas[i] === 3)!;
    expect(g.nox[e]).toBeCloseTo(12.5, 4);
    expect(g.ukuranKomponen.length).toBe(2);
    // nearer to the fragment (35 m) than to the big piece (111 m), but snaps to the big piece
    const u = simpulTerdekat(g, B0, L0 + 3 * D - 0.0003);
    expect(g.ukuranKomponen[g.komponen[u]]).toBe(10);
    expect(simpulTerdekat(g, B0 + 0.1, L0)).toBe(-1); // 11 km away: none
  });
});
