/**
 * M-T06: data of the /sensor/titik page (where the next sensors open the most of the map's blindness), written by
 * D:/breeva-ml-data/titik_sensor/ekspor_halaman.py from the M-T00, M-T02 and M-T03 outputs. Pure helpers, no React.
 */
import { formatAngka } from './angka';

export interface TitikSensor {
  peringkat: number; nama: string; jenis: string; lat: number; lon: number;
  dJ_marginal_pct: number; dJ_kumulatif_pct: number;
  bangunan_baru_1km_m2: number; bangunan_baru_1km_pct_wilayah: number; fasilitas_baru_1km: number;
  e_sekitar_1km_sebelum: number | null; e_sekitar_1km_sesudah: number | null; jarak_sensor_terdekat_km: number | null;
}

export interface DataTitik {
  wilayah: string; dibuat: string; sel_m: number; label: string; alasan_label?: string;
  uji_metode: { lolos_urutan_dari_9: number; spearman: number; teruji: boolean };
  sensor_ada: number; e_median: number; e_p90: number;
  cakupan: Record<'<1 km' | '1-2 km' | '>2 km', { bangunan_pct: number; fasilitas_pct: number; sel: number }>;
  fasilitas_jarak: { '<1 km': number; '1-2 km': number; '>2 km': number; total: number };
  kurva_manfaat_pct: number[];
  cek_dua_titik: { dicari_di?: number; greedy_pct: number; terbaik_lengkap_pct: number; rasio: number | null };
  kepekaan: { utama_vs_penduduk: number; utama_vs_separuh: number; pembanding_n: number };
  titik: TitikSensor[];
  sensor: Array<[number, number]>;
  /** the blindness fog as one image on a 0.00225 degree lat/lon grid (about 250 m): file name next to the JSON, bounds */
  kabut: { png: string; bounds: [[number, number], [number, number]]; piksel: [number, number] };
  sel_jumlah: number;
}

const JENIS: Record<string, string> = {
  school: 'sekolah', kindergarten: 'PAUD/TK', pendidikan: 'sekolah', clinic: 'klinik', hospital: 'rumah sakit', doctors: 'praktik dokter',
  kesehatan: 'faskes', kantor_desa: 'kantor desa/kelurahan', university: 'kampus',
};

export function jenisKata(j: string): string {
  return JENIS[j] ?? j;
}

/** One point in plain words: what opens if a sensor stands there. */
export function kalimatTitik(t: TitikSensor): string {
  const bagian = [`Membuka ${formatAngka(t.dJ_marginal_pct, 1, 1)}% kabut kebutaan wilayah ini`];
  if (t.bangunan_baru_1km_pct_wilayah > 0) bagian.push(`${formatAngka(t.bangunan_baru_1km_pct_wilayah, 1, 1)}% bangunan wilayah baru masuk 1 km dari sensor`);
  if (t.fasilitas_baru_1km > 0) bagian.push(`${t.fasilitas_baru_1km} sekolah dan faskes baru dalam 1 km`);
  if (t.e_sekitar_1km_sebelum != null && t.e_sekitar_1km_sesudah != null)
    bagian.push(`galat perkiraan per jam di sekitarnya turun dari ${formatAngka(t.e_sekitar_1km_sebelum, 1, 1)} ke ${formatAngka(t.e_sekitar_1km_sesudah, 1, 1)} µg/m³`);
  bagian.push(t.jarak_sensor_terdekat_km == null ? 'belum ada sensor lain di wilayah ini' : `sensor terdekat ${formatAngka(t.jarak_sensor_terdekat_km, 1, 1)} km`);
  return `${bagian.join('; ')}.`;
}

/** The ranked points as CSV (for the dinas and the school letter, M-S04). */
export function csvTitik(d: DataTitik): string {
  const kepala = ['peringkat', 'nama', 'jenis', 'lat', 'lon', 'kabut_terbuka_pct', 'kumulatif_pct', 'bangunan_baru_1km_pct', 'fasilitas_baru_1km',
    'galat_sebelum_ug_m3', 'galat_sesudah_ug_m3', 'sensor_terdekat_km', 'label'];
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const baris = d.titik.map((t) => [t.peringkat, t.nama, jenisKata(t.jenis), t.lat, t.lon, t.dJ_marginal_pct, t.dJ_kumulatif_pct, t.bangunan_baru_1km_pct_wilayah,
    t.fasilitas_baru_1km, t.e_sekitar_1km_sebelum, t.e_sekitar_1km_sesudah, t.jarak_sensor_terdekat_km, d.label].map(q).join(','));
  return [kepala.join(','), ...baris].join('\n') + '\n';
}

/** Colour of a blindness cell (0-255): pale to deep orange; 0 is transparent. */
export function warnaKabut(b: number): string | null {
  if (b <= 0) return null;
  const t = Math.min(1, b / 255);
  const a = 0.15 + 0.7 * Math.sqrt(t);
  return `rgba(${Math.round(254 - 60 * t)},${Math.round(178 - 140 * t)},${Math.round(76 - 70 * t)},${a.toFixed(2)})`;
}

export const WILAYAH_TITIK = [
  { name: 'badung_denpasar', label: 'Badung–Denpasar' },
  { name: 'kota_bogor', label: 'Kota Bogor' },
] as const;
