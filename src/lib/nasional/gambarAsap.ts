/**
 * M-U16 (27 Nov 2026): the national exhaust roads drawn the way the pilot roads are, on canvas tiles of a grid layer
 * (lib/field/gambarRuas.ts does it for the pilot field). They used to be one Leaflet polyline per road on a shared canvas:
 * thousands of path objects that Leaflet re-projects and redraws at the end of every zoom (longest task 286-464 ms at
 * CPU 6x in Jakarta and Surabaya, lag_ukur 27 Nov), and lines of a fixed 2-4 px, so the pilot regions and the rest of the
 * country looked like two different maps (Tristan, 27 Nov). Pure: the canvas is passed in, so it is tested with a fake.
 */

/** Zoom of the tiles the phone computes exhaust for (asapNasional.worker.ts). */
export const UBIN_ASAP_Z = 14;

/** Web Mercator, normalised to 0..1 across the world. */
export const mercX = (lon: number): number => (lon + 180) / 360;
export const mercY = (lat: number): number => { const r = (lat * Math.PI) / 180; return (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2; };

/** The computed tiles a display tile is drawn from: its z14 ancestor from z14 on, its four z14 children at z13. */
export function ubinInduk(z: number, x: number, y: number): Array<[number, number]> {
  if (z >= UBIN_ASAP_Z) { const d = z - UBIN_ASAP_Z; return [[x >> d, y >> d]]; }
  if (z === UBIN_ASAP_Z - 1) return [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]];
  return [];
}

/** Centre of a z14 tile as [lat, lon] (to ask whether a pilot region draws that place instead). */
export function pusatUbin(x: number, y: number, z = UBIN_ASAP_Z): [number, number] {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lat, lon];
}

export interface RuasUbin { coords: Float32Array; offs: Uint32Array; nox: Float32Array; k: Uint8Array }
/** A computed tile ready to draw: its points in normalised Mercator and each road's box, worked out once. */
export interface UbinSiap { nx: Float64Array; ny: Float64Array; kotak: Float64Array; offs: Uint32Array; nox: Float32Array; k: Uint8Array }

export function siapkanUbin(t: RuasUbin): UbinSiap {
  const n = t.coords.length / 2, m = t.offs.length - 1;
  const nx = new Float64Array(n), ny = new Float64Array(n), kotak = new Float64Array(4 * Math.max(0, m));
  for (let i = 0; i < n; i++) { nx[i] = mercX(t.coords[2 * i]); ny[i] = mercY(t.coords[2 * i + 1]); }
  for (let r = 0; r < m; r++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let o = t.offs[r]; o < t.offs[r + 1]; o++) { if (nx[o] < x0) x0 = nx[o]; if (nx[o] > x1) x1 = nx[o]; if (ny[o] < y0) y0 = ny[o]; if (ny[o] > y1) y1 = ny[o]; }
    kotak[4 * r] = x0; kotak[4 * r + 1] = y0; kotak[4 * r + 2] = x1; kotak[4 * r + 3] = y1;
  }
  return { nx, ny, kotak, offs: t.offs, nox: t.nox, k: t.k };
}

export interface GayaGaris { color: string; weight: number; opacity: number }
export interface KanvasGaris {
  strokeStyle: string | CanvasGradient | CanvasPattern; lineWidth: number; globalAlpha: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
}

/**
 * Draws the roads of computed tiles into one display tile (z, x, y) of `ukuran` CSS pixels, on a canvas scaled by dpr.
 * Roads outside the tile (plus a margin for the line width) are skipped; roads of one style are stroked together, thin
 * styles first so the main roads end on top (as gambarRuas). Returns how many roads were drawn.
 */
export function gambarAsap(ctx: KanvasGaris, ubin: readonly UbinSiap[], tile: { z: number; x: number; y: number }, ukuran: number, dpr: number,
  gaya: (kelas: number, nox: number, z: number) => GayaGaris | null): number {
  const dunia = 2 ** tile.z, s = ukuran * dpr;
  const pad = 8 / ukuran / dunia; // 8 CSS px in normalised units
  const kiri = tile.x / dunia - pad, atas = tile.y / dunia - pad, kanan = (tile.x + 1) / dunia + pad, bawah = (tile.y + 1) / dunia + pad;
  const kelompok = new Map<string, { g: GayaGaris; garis: Array<[UbinSiap, number]> }>();
  for (const u of ubin) {
    for (let r = 0; r + 1 < u.offs.length; r++) {
      if (u.kotak[4 * r] > kanan || u.kotak[4 * r + 2] < kiri || u.kotak[4 * r + 1] > bawah || u.kotak[4 * r + 3] < atas) continue;
      const g = gaya(u.k[r], u.nox[r], tile.z);
      if (!g || g.weight <= 0 || g.opacity <= 0) continue;
      const key = `${g.color}|${g.weight}|${g.opacity}`;
      let grp = kelompok.get(key);
      if (!grp) { grp = { g, garis: [] }; kelompok.set(key, grp); }
      grp.garis.push([u, r]);
    }
  }
  let n = 0;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const { g, garis } of [...kelompok.values()].sort((a, b) => a.g.weight - b.g.weight)) {
    ctx.strokeStyle = g.color; ctx.lineWidth = g.weight * dpr; ctx.globalAlpha = g.opacity;
    ctx.beginPath();
    for (const [u, r] of garis) {
      for (let o = u.offs[r]; o < u.offs[r + 1]; o++) {
        const px = (u.nx[o] * dunia - tile.x) * s, py = (u.ny[o] * dunia - tile.y) * s;
        if (o === u.offs[r]) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      n++;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return n;
}
