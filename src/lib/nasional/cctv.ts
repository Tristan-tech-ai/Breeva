/**
 * N-35: the traffic-camera layer of /pantau, from v/nasional/cctv.json (written every 20 minutes by breeva-cctv in AWS
 * Jakarta, infra/cctv/app.py). Per camera: point, name, vehicles seen in one frame, the mean of the last hour and that
 * mean against the camera's own 24-hour median. No picture and no stream address are ever published. Contest trial only,
 * switched off 6 Dec 2026; not part of the map numbers (not yet through the hidden-location test, N-34).
 */
import { kmBetween } from './pantau';
import { formatAngka } from '../angka';

export const CCTV_PATH = 'v/nasional/cctv.json';
export const CCTV_LABEL = 'uji coba selama lomba, izin tertulis sedang diproses';

export type CctvTingkat = 'sepi' | 'biasa' | 'padat';
export interface CctvKamera {
  id: string; kota: string; nama: string; lat: number; lon: number;
  status: 'ok' | 'buram' | 'offline'; total: number | null; rata_jam: number | null; indeks: number | null; tingkat: CctvTingkat | null;
  /** N-44: the camera's typical count at this hour on earlier days (null until there is one) */
  biasa_jam_ini?: number | null;
}
export interface CctvFile { format: 'cctv_publik'; updated_at: string; label: string; model: string; catatan: string; kamera: CctvKamera[] }

export const KOTA_CCTV: Record<string, string> = { kota_bogor: 'Kota Bogor', kota_bandung: 'Kota Bandung', kota_yogyakarta: 'Kota Yogyakarta' };

const WARNA: Record<CctvTingkat | 'belum' | 'mati', string> = { sepi: '#16a34a', biasa: '#ca8a04', padat: '#dc2626', belum: '#0f766e', mati: '#94a3b8' };

/** Marker colour: by the density level once a camera has 3 hours of runs, teal before that, grey when it shows nothing. */
export function warnaCctv(k: CctvKamera): string {
  if (k.status !== 'ok') return WARNA.mati;
  return k.tingkat ? WARNA[k.tingkat] : WARNA.belum;
}

/** Tooltip text of one camera. */
export function teksCctv(k: CctvKamera): string {
  const nama = k.nama || 'Kamera lalu lintas';
  if (k.status === 'offline') return `${nama} · kamera tidak menayangkan gambar saat diperiksa`;
  if (k.status === 'buram') return `${nama} · gambar buram atau gelap, tidak dihitung`;
  const rata = k.rata_jam != null ? `, rata-rata jam terakhir ${formatAngka(k.rata_jam, 0, 1)}` : '';
  const biasa = k.biasa_jam_ini != null ? `, biasanya ${formatAngka(k.biasa_jam_ini, 0, 1)} pada jam ini` : '';
  const ting = k.tingkat ? ` · ${k.tingkat} dibanding jam yang sama kemarin${biasa}` : ' · belum ada data jam yang sama kemarin';
  return `${nama} · ${k.total ?? 0} kendaraan terlihat${rata}${ting}`;
}

/** Cameras within km of a place, nearest first. */
export function cctvDekat(file: CctvFile | null, lat: number, lon: number, km: number): CctvKamera[] {
  if (!file) return [];
  return file.kamera.map((k) => ({ k, d: kmBetween(lat, lon, k.lat, k.lon) })).filter((x) => x.d <= km).sort((a, b) => a.d - b.d).map((x) => x.k);
}

/** The cameras of one kab/kota page: the trial cities are keyed kota_bogor etc., the pages kota-bogor (a camera of Kota
 * Bogor is not shown on Kabupaten Bogor, whose box contains the city). */
export function kameraKabKota(file: CctvFile | null, slug: string): CctvKamera[] {
  return (file?.kamera ?? []).filter((k) => k.kota.replace(/_/g, '-') === slug);
}

/** Per city: cameras, how many showed a countable picture, vehicles seen in the latest frames, and how many are busy. */
export interface RingkasKota { kota: string; nama: string; kamera: number; ok: number; kendaraan: number; padat: number; mati: number }

export function ringkasCctv(kamera: CctvKamera[]): RingkasKota[] {
  const by = new Map<string, RingkasKota>();
  for (const k of kamera) {
    const r = by.get(k.kota) ?? { kota: k.kota, nama: KOTA_CCTV[k.kota] ?? k.kota, kamera: 0, ok: 0, kendaraan: 0, padat: 0, mati: 0 };
    r.kamera += 1;
    if (k.status === 'offline') r.mati += 1;
    if (k.status === 'ok') { r.ok += 1; r.kendaraan += k.total ?? 0; }
    if (k.tingkat === 'padat') r.padat += 1;
    by.set(k.kota, r);
  }
  return [...by.values()].sort((a, b) => b.kamera - a.kamera);
}

/** N-119: the line for one city; when every camera of the city was offline in the last run, its server did not answer. */
export function barisKota(r: RingkasKota): string {
  const n = (x: number) => x.toLocaleString('id-ID');
  if (r.kamera > 0 && r.mati === r.kamera) return `${r.nama}: server kamera kota ini tidak menjawab pada run terakhir (${n(r.kamera)} kamera); dicoba lagi tiap 20 menit`;
  return `${r.nama}: ${n(r.ok)} dari ${n(r.kamera)} kamera terbaca, ${n(r.kendaraan)} kendaraan terlihat${r.padat ? `, ${r.padat} lebih padat dari jam yang sama kemarin` : ''}`;
}

/** The file is stale when the last run is more than an hour old (the schedule runs every 20 minutes). */
export function cctvBasi(file: CctvFile | null, now = Date.now()): boolean {
  return !file || now - Date.parse(file.updated_at) > 60 * 60 * 1000;
}
