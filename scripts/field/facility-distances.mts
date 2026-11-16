/**
 * Facility table for the priority list of a new region (task F1-16), in the columns of the proposal's
 * sumber_proposal/data/fasilitas_jarak.csv (Badung-Denpasar) so scripts/field/priority.mts reads it unchanged:
 *   t, id, kelas, jenis, nama, lat, lon, jarak_m, jalan, d_major, d_ramai
 * Definitions as in sumber_proposal/analisis_g.py: d_major = metres to the nearest major road (motorway, trunk,
 * primary, secondary and their links), d_ramai = to the nearest major or tertiary road ("jalan ramai"), jarak_m =
 * d_ramai and jalan = that road's class. Facilities: school, kindergarten, childcare (pendidikan), clinic and hospital
 * (kesehatan), as in the Badung list.
 *
 *   pnpm exec tsx scripts/field/facility-distances.mts --facilities D:/breeva-ml-data/field/osm/kota_bogor_facilities.json \
 *        --pack D:/breeva-ml-data/field/packs/2026-11/kota_bogor.bin --out D:/breeva-ml-data/field/osm/kota_bogor_fasilitas_jarak.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RoadPack } from './pack.js';

export const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary', 'secondary_link']);
export const RAMAI = new Set([...MAJOR, 'tertiary', 'tertiary_link']);
const KELAS: Record<string, 'pendidikan' | 'kesehatan'> = { school: 'pendidikan', kindergarten: 'pendidikan', childcare: 'pendidikan', clinic: 'kesehatan', hospital: 'kesehatan' };

interface Element { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
export interface FacilityRow { t: string; id: number; kelas: string; jenis: string; nama: string; lat: number; lon: number; jarak_m: number; jalan: string; d_major: number; d_ramai: number }

const M_LAT = 110574;
function segDist(lat: number, lon: number, a: number[], b: number[]): number {
  const kx = M_LAT * Math.cos((lat * Math.PI) / 180);
  const px = lon * kx, py = lat * M_LAT, ax = a[0] * kx, ay = a[1] * M_LAT, bx = b[0] * kx, by = b[1] * M_LAT;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(ax + u * dx - px, ay + u * dy - py);
}

/** Nearest road of a class set: grid of 0.005-degree cells, searched in growing rings up to about 5 km. */
export function nearestOfClass(pack: RoadPack, classes: Set<string>) {
  const cell = 0.005;
  const grid = new Map<string, number[]>();
  for (let k = 0; k < pack.n; k++) {
    if (!classes.has(pack.highway(k))) continue;
    for (const [lon, lat] of pack.coords(k)) {
      const key = `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
      const g = grid.get(key) ?? [];
      if (g[g.length - 1] !== k) g.push(k);
      grid.set(key, g);
    }
  }
  return (lat: number, lon: number): { k: number; d: number } | null => {
    const cx = Math.floor(lon / cell), cy = Math.floor(lat / cell);
    let best: { k: number; d: number } | null = null;
    for (let ring = 0; ring <= 9; ring++) {
      const seen = new Set<number>();
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const c = pack.coords(k);
          for (let q = 1; q < c.length; q++) { const d = segDist(lat, lon, c[q - 1], c[q]); if (!best || d < best.d) best = { k, d }; }
        }
      }
      // a road found in ring r is at most r+1 cells away; one more ring cannot hold a closer one beyond that bound
      if (best && best.d <= ring * cell * M_LAT * Math.cos((lat * Math.PI) / 180)) break;
    }
    return best;
  };
}

export function facilityRows(elements: Element[], pack: RoadPack): FacilityRow[] {
  const major = nearestOfClass(pack, MAJOR), ramai = nearestOfClass(pack, RAMAI);
  const out: FacilityRow[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const jenis = KELAS[tags.amenity ?? ''] ? tags.amenity! : KELAS[tags.healthcare ?? ''] ? tags.healthcare! : null;
    if (!jenis) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = ramai(lat, lon), m = major(lat, lon);
    if (!r || !m) continue;
    out.push({
      t: el.type, id: el.id, kelas: KELAS[jenis], jenis, nama: (tags.name ?? '').trim() || `(${jenis} tanpa nama)`, lat, lon,
      jarak_m: r.d, jalan: pack.highway(r.k), d_major: m.d, d_ramai: r.d,
    });
  }
  return out;
}

const csvField = (v: string | number) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
export function toCsv(rows: FacilityRow[]): string {
  const cols: Array<keyof FacilityRow> = ['t', 'id', 'kelas', 'jenis', 'nama', 'lat', 'lon', 'jarak_m', 'jalan', 'd_major', 'd_ramai'];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvField(r[c])).join(','))].join('\n') + '\n';
}

if (process.argv[1]?.endsWith('facility-distances.mts')) {
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) throw new Error(`missing --${n}`); return process.argv[i + 1]; };
  const pack = new RoadPack(new Uint8Array(readFileSync(arg('pack'))));
  const rows = facilityRows((JSON.parse(readFileSync(arg('facilities'), 'utf8')) as { elements: Element[] }).elements, pack);
  writeFileSync(arg('out'), toCsv(rows));
  const by: Record<string, number> = {};
  for (const r of rows) by[r.jenis] = (by[r.jenis] ?? 0) + 1;
  console.log(JSON.stringify({ out: arg('out'), facilities: rows.length, by, median_d_ramai_m: Math.round([...rows.map((r) => r.d_ramai)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]) }));
}
