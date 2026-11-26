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
  /** M-T03 complete: role and the four value components (percentage points of the region's fog) */
  peran?: string; stratum?: string; nilai_kabut?: number; nilai_penjaga_asap?: number; nilai_strata?: number; nilai_kalibrasi?: number; nilai_total?: number;
  km2_terbuka_1km?: number; bangunan_pindah_ke_terukur_pct?: number; jarak_rujukan_km?: number | null;
}

export interface DataTitik {
  wilayah: string; dibuat: string; sel_m: number; label: string; alasan_label?: string;
  uji_metode: { lolos_urutan_dari_9: number; spearman: number; teruji: boolean };
  sensor_ada: number; e_median: number; e_p90: number;
  cakupan: Record<'<1 km' | '1-2 km' | '>2 km', { bangunan_pct: number; fasilitas_pct: number; sel: number }>;
  fasilitas_jarak: { '<1 km': number; '1-2 km': number; '>2 km': number; total: number };
  kurva_manfaat_pct: number[];
  cek_dua_titik: { dicari_di?: number; greedy_pct?: number; terbaik_lengkap_pct?: number; greedy_total?: number; terbaik_lengkap_total?: number; rasio: number | null };
  ketahanan?: { kehilangan_kabut_terbesar_pct: number | null };
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
/** M-T10: the ten 2027 cities on the app layer. Bali is left out: the pilot points of Badung-Denpasar are finer there. */
export function kotaLapisan(kota: KotaTitik[]): KotaTitik[] {
  return kota.filter((k) => !/^Bali\b/.test(k.kota));
}

/** M-T10: title and popup sentence of one city point (indicative, the placement method is not validated). */
export function teksTitikKota(k: KotaTitik, t: KotaTitik['titik'][number]): { judul: string; kalimat: string } {
  return {
    judul: `${k.kota} 2027, titik sensor ${t.peringkat}: ${t.nama}`,
    kalimat: `Mengurangi kebutaan peta kota ini sekitar ${formatAngka(t.manfaat_pct, 1, 1)}%. Indikatif: cara memilih titik belum lolos uji kami.`,
  };
}

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

const PERAN: Record<string, string> = {
  latar: 'latar: mengukur udara umum lingkungan, jauh dari jalan utama',
  'penjaga asap': 'penjaga asap: di arah datang asap kebakaran, memberi tanda lebih awal',
  strata: 'strata: mewakili jenis tempat yang belum punya sensor',
  kalibrasi: 'kalibrasi: dekat stasiun rujukan, untuk menyetel sensor murah di sekitarnya',
};

/** The role of a point and its value components, in plain words (empty when the file has no components). */
export function kalimatPeran(t: TitikSensor): string {
  if (!t.peran || t.nilai_total == null) return '';
  const f = (x: number | undefined) => formatAngka(x ?? 0, 1, 1);
  const strata = t.stratum ? ` (${t.stratum})` : '';
  return `Peran ${PERAN[t.peran] ?? t.peran}${t.peran === 'strata' ? strata : ''}. Nilai ${f(t.nilai_total)} poin = kabut ${f(t.nilai_kabut)} + penjaga asap ${f(t.nilai_penjaga_asap)} + strata ${f(t.nilai_strata)} + kalibrasi ${f(t.nilai_kalibrasi)}.`;
}

export interface KotaTitik { kota: string; sensor_ada?: number; titik: Array<{ peringkat: number; nama: string; lat: number; lon: number; manfaat_pct: number }> }
export interface KabTitik { peringkat: number; nama: string; provinsi?: string; skor: number; alasan: string }
