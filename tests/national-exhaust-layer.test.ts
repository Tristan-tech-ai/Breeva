import { describe, expect, it } from 'vitest';
import { inPilot } from '../src/lib/nasional/ubinView';
import { tileOf } from '../src/lib/nasional/mvt';
import { gambarAsap, mercX, mercY, pusatUbin, siapkanUbin, UBIN_ASAP_Z, ubinInduk, type KanvasGaris } from '../src/lib/nasional/gambarAsap';

/** A canvas that records what is stroked. */
function kanvas() {
  const coret: Array<{ color: string; width: number; alpha: number; titik: Array<[string, number, number]> }> = [];
  let jalur: Array<[string, number, number]> = [];
  const ctx = {
    strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
    beginPath() { jalur = []; }, moveTo(x: number, y: number) { jalur.push(['M', x, y]); }, lineTo(x: number, y: number) { jalur.push(['L', x, y]); },
    stroke() { coret.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth, alpha: ctx.globalAlpha, titik: jalur }); },
  };
  return { ctx: ctx as unknown as KanvasGaris, coret };
}

describe('N-21 national exhaust layer', () => {
  it('leaves the pilot regions to the cloud field', () => {
    expect(inPilot(-8.67, 115.21)).toBe(true); // Denpasar
    expect(inPilot(-6.59, 106.80)).toBe(true); // Kota Bogor
    expect(inPilot(-5.14, 119.43)).toBe(false); // Makassar
  });

  it('M-U16: a display tile is drawn from its z14 ancestor, or at z13 from its four z14 children', () => {
    const [x, y] = tileOf(106.83, -6.2, UBIN_ASAP_Z); // Jakarta
    expect(ubinInduk(14, x, y)).toEqual([[x, y]]);
    expect(ubinInduk(16, 4 * x + 3, 4 * y + 1)).toEqual([[x, y]]);
    expect(ubinInduk(13, x >> 1, y >> 1)).toEqual(expect.arrayContaining([[x & ~1, y & ~1], [(x & ~1) + 1, (y & ~1) + 1]]));
    expect(ubinInduk(13, x >> 1, y >> 1)).toHaveLength(4);
    expect(ubinInduk(12, 0, 0)).toEqual([]);
    // the tile's centre lies inside the tile
    const [lat, lon] = pusatUbin(x, y);
    expect(tileOf(lon, lat, UBIN_ASAP_Z)).toEqual([x, y]);
  });

  it('M-U16: draws a road at the right pixels, one stroke per style, thin first, and skips roads outside the tile', () => {
    const [x, y] = tileOf(106.83, -6.2, UBIN_ASAP_Z);
    const n = 2 ** UBIN_ASAP_Z;
    // tile-relative position (0..1) to lon/lat
    const lon = (u: number) => ((x + u) / n) * 360 - 180;
    const lat = (v: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v)) / n))) * 180) / Math.PI;
    // road 0: a lane across the middle; road 1: a main road down the middle; road 2: far outside (two tiles east)
    const coords = Float32Array.from([lon(0.25), lat(0.5), lon(0.75), lat(0.5), lon(0.5), lat(0.25), lon(0.5), lat(0.75), lon(2.2), lat(0.5), lon(2.8), lat(0.5)]);
    const siap = siapkanUbin({ coords, offs: Uint32Array.from([0, 2, 4, 6]), nox: Float32Array.from([1, 20, 5]), k: Uint8Array.from([7, 2, 7]) });
    expect(mercX(lon(0.5)) * n - x).toBeCloseTo(0.5, 3);
    expect(mercY(lat(0.5)) * n - y).toBeCloseTo(0.5, 3);
    const gaya = (kelas: number) => (kelas === 2 ? { color: '#400', weight: 3, opacity: 0.9 } : { color: '#0aa', weight: 0.5, opacity: 0.5 });
    const { ctx, coret } = kanvas();
    const digambar = gambarAsap(ctx, [siap], { z: UBIN_ASAP_Z, x, y }, 256, 2, gaya);
    expect(digambar).toBe(2); // the far road is not drawn
    expect(coret.map((c) => [c.color, c.width, c.alpha])).toEqual([['#0aa', 1, 0.5], ['#400', 6, 0.9]]); // widths x dpr, thin first
    // the lane runs from a quarter to three quarters of the 512 px canvas, at half its height (float32 lon/lat: within 2 px)
    const [m, l] = coret[0].titik;
    expect(m[0]).toBe('M'); expect(l[0]).toBe('L');
    expect(Math.abs(m[1] - 128)).toBeLessThan(2); expect(Math.abs(l[1] - 384)).toBeLessThan(2);
    expect(Math.abs(m[2] - 256)).toBeLessThan(2); expect(Math.abs(l[2] - 256)).toBeLessThan(2);
    // one zoom in, the north-west child shows the upper left quarter twice as large
    const anak = kanvas();
    gambarAsap(anak.ctx, [siap], { z: UBIN_ASAP_Z + 1, x: 2 * x, y: 2 * y }, 256, 1, gaya);
    const laneAnak = anak.coret.find((c) => c.color === '#0aa')!.titik;
    expect(Math.abs(laneAnak[0][1] - 128)).toBeLessThan(2); // 0.25 of the parent = 0.5 of the child = 128 px at dpr 1
    expect(Math.abs(laneAnak[0][2] - 256)).toBeLessThan(2); // 0.5 of the parent = the child's lower edge
    // a style that hides a class draws nothing of it
    const kosong = kanvas();
    expect(gambarAsap(kosong.ctx, [siap], { z: UBIN_ASAP_Z, x, y }, 256, 1, () => null)).toBe(0);
  });
});
