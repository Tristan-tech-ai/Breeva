/** N-24: the kab/kota index of /pantau (v/nasional/kabkota_indeks.json) and the helpers its pages use. Pure. */
import type { FirePoint } from './firms';
import type { LatarFile, Tingkat } from './latar';
import { kmBetween } from './pantau';

export interface KabKota { slug: string; nama: string; provinsi: string; iso: string; lon: number; lat: number; bbox: [number, number, number, number] }
export interface KabKotaIndeks { format: 'kabkota_indeks'; kolom: string[]; baris: Array<[string, string, string, string, number, number, number, number, number, number]> }

export function bacaIndeks(f: KabKotaIndeks | null): KabKota[] {
  return (f?.baris ?? []).map(([slug, nama, provinsi, iso, lon, lat, w, s, e, n]) => ({ slug, nama, provinsi, iso, lon, lat, bbox: [w, s, e, n] }));
}

const lipat = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Search by name or province; names that start with the query first, then the rest, at most `max`. */
export function cariKabKota(all: KabKota[], q: string, max = 12): KabKota[] {
  const t = lipat(q.trim());
  if (!t) return [];
  const words = (k: KabKota) => lipat(k.nama).replace(/^(kota|kabupaten) /, '');
  const hit = all.filter((k) => lipat(k.nama).includes(t) || lipat(k.provinsi).includes(t));
  return hit.sort((a, b) => Number(!words(a).startsWith(t)) - Number(!words(b).startsWith(t)) || a.nama.localeCompare(b.nama)).slice(0, max);
}

/** N-49: kab/kota answers in the main map's search box: from 3 letters, at most 3, names only (not provinces, which
 * would fill the list with every kab/kota of "Jawa Barat"). */
export function kabKotaUntukCari(all: KabKota[], q: string, max = 3): KabKota[] {
  const t = lipat(q.trim());
  if (t.length < 3) return [];
  return cariKabKota(all.filter((k) => lipat(k.nama).includes(t)), q, max);
}

let indeksJanji: Promise<KabKota[]> | null = null;
/** The kab/kota index from the CDN, loaded once per page (when the search box is first used). */
export function muatIndeksKabKota(base: string): Promise<KabKota[]> {
  if (!indeksJanji) {
    indeksJanji = fetch(`${base}/v/nasional/kabkota_indeks.json`).then((r) => (r.ok ? r.json() : null)).then((j) => bacaIndeks(j as KabKotaIndeks | null));
    indeksJanji.catch(() => { indeksJanji = null; });
  }
  return indeksJanji;
}

export const TINGKAT_LABEL: Record<Tingkat, string> = {
  terukur: 'terukur: sensor warga dalam 25 km',
  terkalibrasi: 'terkalibrasi: dikoreksi sensor dalam 150 km',
  indikatif: 'indikatif: belum ada titik ukur di dekatnya',
};

/** Current background value and level of one kab/kota, with the hour index closest to now. */
export function latarSini(l: LatarFile | null, slug: string, now = Date.now()): { v: number | null; t: Tingkat; s: number; seri: (number | null)[]; jam: string[]; i: number } | null {
  const w = l?.wilayah[slug];
  if (!l || !w) return null;
  let i = 0;
  l.hours.forEach((h, k) => { if (Math.abs(Date.parse(h) - now) < Math.abs(Date.parse(l.hours[i]) - now)) i = k; });
  return { v: w.v[i] ?? null, t: w.t, s: w.s, seri: w.v, jam: l.hours, i };
}

/** Fire points inside the kab/kota (tagged by the builder) and those within `km` of its centre but outside it. */
export function apiSini(points: FirePoint[], k: KabKota, km = 50): { dalam: FirePoint[]; dekat: Array<{ p: FirePoint; km: number }> } {
  const dalam = points.filter((p) => p[6] === k.slug);
  const dekat = points.filter((p) => p[6] !== k.slug).map((p) => ({ p, km: kmBetween(k.lat, k.lon, p[1], p[0]) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);
  return { dalam, dekat };
}

/** CSV of the kab/kota: the 48 background hours, then its fire points (UTF-8 with BOM). */
export function kabKotaCsv(k: KabKota, l: ReturnType<typeof latarSini>, api: FirePoint[]): string {
  const rows = ['bagian,waktu_utc,pm25_latar_ugm3,tingkat,lat,lon,daya_mw,keyakinan'];
  if (l) l.jam.forEach((h, j) => rows.push(`latar,${h},${l.seri[j] ?? ''},${l.t},,,,`));
  for (const p of api) rows.push(`titik_api,${p[4]},,,${p[1]},${p[0]},${p[2]},${p[3]}`);
  return '﻿' + `# ${k.nama}, ${k.provinsi}\n` + rows.join('\n') + '\n';
}
