/**
 * N-23: Indonesian kabupaten/kota boundaries (OSM admin_level 5, 513 of 514, file v/nasional/kabkota.geojson) and a
 * point lookup. Used by the builder to keep only fire points inside Indonesia and to name their kab/kota and province.
 */
import type { FirePoint } from './firms';

export interface WilayahProps {
  slug: string;
  nama: string;
  provinsi: string;
  iso: string;
  pusat: [number, number];
  luas_km2: number;
  kode?: string | null;
}

type Ring = number[][];
type Poly = Ring[];
interface Geom { type: 'Polygon' | 'MultiPolygon'; coordinates: Poly | Poly[] }
export interface WilayahFC { type: 'FeatureCollection'; features: Array<{ properties: WilayahProps; geometry: Geom }> }

export interface WilayahIndex { items: Array<{ p: WilayahProps; bbox: [number, number, number, number]; polys: Poly[] }> }

export function indexWilayah(fc: WilayahFC): WilayahIndex {
  const items = fc.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Poly[];
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    return { p: f.properties, bbox: [w, s, e, n] as [number, number, number, number], polys };
  });
  return { items };
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPoly = (x: number, y: number, poly: Poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

/** The kab/kota containing the point, or null (outside Indonesia's land boundaries, or in the one kab/kota not in the file). */
export function cariWilayah(idx: WilayahIndex, lon: number, lat: number): WilayahProps | null {
  for (const it of idx.items) {
    const [w, s, e, n] = it.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (it.polys.some((p) => inPoly(lon, lat, p))) return it.p;
  }
  return null;
}

/** Keep the fire points inside an Indonesian kab/kota and append its slug and province code; count the rest. */
export function tandaiWilayah(points: FirePoint[], idx: WilayahIndex): { points: FirePoint[]; luar: number; luar_points: FirePoint[]; per_provinsi: Record<string, number> } {
  const out: FirePoint[] = [];
  const per: Record<string, number> = {};
  let luar = 0;
  const luarPts: FirePoint[] = [];
  for (const p of points) {
    const w = cariWilayah(idx, p[0], p[1]);
    if (!w) { luar++; luarPts.push(p.slice(0, 6) as FirePoint); continue; }
    out.push([p[0], p[1], p[2], p[3], p[4], p[5], w.slug, w.iso]);
    per[w.iso] = (per[w.iso] ?? 0) + 1;
  }
  return { points: out, luar, luar_points: luarPts, per_provinsi: per };
}

/** The 38 provinces (ISO 3166-2:ID) and their names as in OSM. */
export const PROVINSI: Record<string, string> = {
  'ID-AC': 'Aceh', 'ID-SU': 'Sumatera Utara', 'ID-SB': 'Sumatera Barat', 'ID-RI': 'Riau', 'ID-KR': 'Kepulauan Riau', 'ID-JA': 'Jambi',
  'ID-SS': 'Sumatera Selatan', 'ID-BB': 'Kepulauan Bangka Belitung', 'ID-BE': 'Bengkulu', 'ID-LA': 'Lampung', 'ID-JK': 'DKI Jakarta',
  'ID-BT': 'Banten', 'ID-JB': 'Jawa Barat', 'ID-JT': 'Jawa Tengah', 'ID-YO': 'DI Yogyakarta', 'ID-JI': 'Jawa Timur', 'ID-BA': 'Bali',
  'ID-NB': 'Nusa Tenggara Barat', 'ID-NT': 'Nusa Tenggara Timur', 'ID-KB': 'Kalimantan Barat', 'ID-KT': 'Kalimantan Tengah',
  'ID-KS': 'Kalimantan Selatan', 'ID-KI': 'Kalimantan Timur', 'ID-KU': 'Kalimantan Utara', 'ID-SA': 'Sulawesi Utara', 'ID-ST': 'Sulawesi Tengah',
  'ID-SN': 'Sulawesi Selatan', 'ID-SG': 'Sulawesi Tenggara', 'ID-GO': 'Gorontalo', 'ID-SR': 'Sulawesi Barat', 'ID-MA': 'Maluku',
  'ID-MU': 'Maluku Utara', 'ID-PA': 'Papua', 'ID-PB': 'Papua Barat', 'ID-PD': 'Papua Barat Daya', 'ID-PE': 'Papua Pegunungan',
  'ID-PS': 'Papua Selatan', 'ID-PT': 'Papua Tengah',
};

/** Fire points per province, largest first (points without a province code are left out). */
export function perProvinsi(points: FirePoint[]): Array<{ iso: string; nama: string; n: number }> {
  const c = new Map<string, number>();
  for (const p of points) if (p[7]) c.set(p[7], (c.get(p[7]) ?? 0) + 1);
  return [...c.entries()].map(([iso, n]) => ({ iso, nama: PROVINSI[iso] ?? iso, n })).sort((a, b) => b.n - a.n);
}
