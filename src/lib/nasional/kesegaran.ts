/**
 * N-48: how fresh the national files are, for /status. Every file carries `updated_at` (ISO, UTC). The builder runs
 * every hour at minute 20 (fresh = under 2 hours); the traffic cameras every 20 minutes (fresh = under 1 hour).
 */
import { CCTV_PATH } from './cctv';

export interface BerkasNasional { kunci: string; label: string; path: string; batasMenit: number; catatan?: string }

export const BERKAS_NASIONAL: BerkasNasional[] = [
  { kunci: 'latar', label: 'Udara latar 513 kabupaten/kota', path: 'v/nasional/latar.json', batasMenit: 120 },
  { kunci: 'angin', label: 'Angin', path: 'v/nasional/angin.json', batasMenit: 120 },
  { kunci: 'api', label: 'Titik api 24 jam', path: 'v/nasional/titik_api.json', batasMenit: 120 },
  { kunci: 'asap', label: 'Perkiraan jalur asap', path: 'v/nasional/asap.json', batasMenit: 120 },
  { kunci: 'sensor', label: 'Sensor.Community (tidak dipakai model)', path: 'v/nasional/sensor_community.json', batasMenit: 120 },
  { kunci: 'cctv', label: 'Kamera lalu lintas', path: CCTV_PATH, batasMenit: 60, catatan: 'uji coba selama lomba, izin tertulis sedang diproses' },
];

export type StatusBerkas = 'segar' | 'tertunda' | 'tidak ada';

export function kesegaran(updatedAt: string | null | undefined, now: number, batasMenit: number): { umurMenit: number | null; status: StatusBerkas } {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(t)) return { umurMenit: null, status: 'tidak ada' };
  const umurMenit = Math.max(0, Math.round((now - t) / 60000));
  return { umurMenit, status: umurMenit <= batasMenit ? 'segar' : 'tertunda' };
}

export function umurTeks(menit: number | null): string {
  if (menit == null) return 'belum terbaca';
  if (menit < 1) return 'baru saja';
  if (menit < 120) return `${menit} menit lalu`;
  if (menit < 48 * 60) return `${Math.round(menit / 60)} jam lalu`;
  return `${Math.round(menit / 1440)} hari lalu`;
}
