/** N-11: pure helpers of the monitoring pages (/pantau): island counts, points near a place, CSV of a priority list. */
import type { FirePoint } from './firms';
import type { Fasilitas } from '../prioritas';

/** Rough island boxes (W, S, E, N) for a first breakdown; a point outside every box counts as "lainnya". */
export const PULAU: Array<{ nama: string; bbox: [number, number, number, number] }> = [
  { nama: 'Sumatra', bbox: [94.5, -6.5, 106.5, 6.5] },
  { nama: 'Jawa', bbox: [105, -9, 114.6, -5.4] },
  { nama: 'Kalimantan', bbox: [108.5, -4.5, 119.5, 4.5] },
  { nama: 'Sulawesi', bbox: [118.6, -6.5, 125.5, 2.5] },
  { nama: 'Bali dan Nusa Tenggara', bbox: [114.4, -11.5, 127.5, -7.8] },
  { nama: 'Maluku', bbox: [124.5, -8.5, 135, 3] },
  { nama: 'Papua', bbox: [130.5, -9.5, 141.5, 0.5] },
];

export function pulauOf(lon: number, lat: number): string {
  const p = PULAU.find(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n);
  return p ? p.nama : 'Lainnya';
}

/** Fire points per island, largest first, islands without fires left out. */
export function perPulau(points: FirePoint[]): Array<{ nama: string; n: number }> {
  const c = new Map<string, number>();
  for (const p of points) c.set(pulauOf(p[0], p[1]), (c.get(pulauOf(p[0], p[1])) ?? 0) + 1);
  return [...c.entries()].map(([nama, n]) => ({ nama, n })).sort((a, b) => b.n - a.n);
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Fire points within `km` of a place, nearest first, with their distance. */
export function nearby(points: FirePoint[], lat: number, lon: number, km: number): Array<{ p: FirePoint; km: number }> {
  return points.map((p) => ({ p, km: kmBetween(lat, lon, p[1], p[0]) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);
}

/** The monitoring regions with a full field (others come with the national rollout, N-24). */
export const PANTAU_WILAYAH = [
  { slug: 'badung-denpasar', field: 'badung_denpasar', label: 'Badung–Denpasar', lat: -8.65, lon: 115.2, tingkat: 'terukur' as const },
  { slug: 'kota-bogor', field: 'kota_bogor', label: 'Kota Bogor', lat: -6.595, lon: 106.79, tingkat: 'indikatif' as const },
];

const csvCell = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`);

/** The priority list as CSV for download (UTF-8 with BOM so spreadsheet apps read the names correctly). */
export function fasilitasCsv(items: Fasilitas[]): string {
  const head = ['peringkat', 'nama', 'jenis', 'lat', 'lon', 'asap_kendaraan_ugm3', 'pm25_ugm3', 'jam_puncak', 'jalan_terdekat', 'jarak_jalan_utama_m'];
  const rows = items.map((f) => [f.peringkat, f.nama, f.jenis, f.lat, f.lon, f.no2_lalin, f.pm25, f.jam_puncak, f.jalan_terdekat, f.d_major_m].map(csvCell).join(','));
  return '﻿' + [head.join(','), ...rows].join('\n') + '\n';
}
