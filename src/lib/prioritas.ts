/** Priority list of schools and health facilities (data written by scripts/field/priority.mts). */

export interface Fasilitas {
  peringkat: number; peringkat_kelas: number; id: string; nama: string;
  kelas: 'pendidikan' | 'kesehatan'; jenis: string; lat: number; lon: number;
  jalan_terdekat: string; d_ramai_m: number; d_major_m: number; jam: number[];
  pm25: number; pm25_latar: number; pm25_lalin: number; no2_lalin: number;
  pm25_puncak: number; jam_puncak: number; pi95: number;
}

export interface DaftarPrioritas {
  wilayah: string; tanggal: string; zona: string; dibuat: string; jumlah: number; urutan: string;
  jam_kegiatan: Record<string, number[]>; mesin: string; cams_harian: number; ruas: number; geometri: string;
  ringkasan: { lalin_di_atas_1: number; lalin_di_atas_0_5: number; pm25_median: number; asap_median?: number; asap_p90?: number };
  fasilitas: Fasilitas[];
}

export const JENIS: Record<string, string> = {
  school: 'Sekolah', kindergarten: 'TK/PAUD', childcare: 'Penitipan anak', clinic: 'Klinik/puskesmas', hospital: 'Rumah sakit',
};

export const JALAN: Record<string, string> = {
  trunk: 'jalan arteri nasional', primary: 'jalan primer', secondary: 'jalan sekunder', tertiary: 'jalan tersier',
};

export type Urutan = 'lalin' | 'total' | 'jarak' | 'nama';

export interface Saring { kelas: 'semua' | 'pendidikan' | 'kesehatan'; cari: string; urutan: Urutan }

/** Regions with a priority list (F1-16). Kota Bogor has no measuring point inside the city: indicative. */
export const PRIORITAS_REGIONS = [
  { name: 'badung_denpasar', label: 'Badung–Denpasar', indicative: false },
  { name: 'kota_bogor', label: 'Kota Bogor', indicative: true },
] as const;
export type PrioritasRegion = (typeof PRIORITAS_REGIONS)[number];

/** Region from ?wilayah=, else Badung-Denpasar. */
export function pickPrioritasRegion(search: string): PrioritasRegion {
  const w = new URLSearchParams(search).get('wilayah');
  return PRIORITAS_REGIONS.find((r) => r.name === w) ?? PRIORITAS_REGIONS[0];
}

/** Rows shown at once; the page offers more on request (the Bogor list has about 1,600 facilities). */
export const PAGE_SIZE = 150;

export function saringUrut(items: Fasilitas[], s: Saring): Fasilitas[] {
  const q = s.cari.trim().toLowerCase();
  const out = items.filter((f) => (s.kelas === 'semua' || f.kelas === s.kelas) && (!q || f.nama.toLowerCase().includes(q)));
  const by: Record<Urutan, (a: Fasilitas, b: Fasilitas) => number> = {
    // vehicle exhaust (traffic NOx) first: the part that differs between facilities (F4-03)
    lalin: (a, b) => b.no2_lalin - a.no2_lalin || b.pm25_lalin - a.pm25_lalin,
    total: (a, b) => b.pm25 - a.pm25,
    jarak: (a, b) => a.d_ramai_m - b.d_ramai_m,
    nama: (a, b) => a.nama.localeCompare(b.nama, 'id'),
  };
  return [...out].sort(by[s.urutan]);
}

/** "07.00–14.00" from the start-of-hour list. */
export function rentangJam(jam: number[]): string {
  if (jam.length === 24) return '24 jam';
  const p = (h: number) => `${String(h).padStart(2, '0')}.00`;
  return `${p(jam[0])}–${p((jam[jam.length - 1] + 1) % 24)}`;
}

export function fmt(x: number, d = 1): string {
  return x.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Banner of a region without a measuring point (F1-27): what is indicative, what still compares, and the evidence (the
 * hidden-city test at Kota Bogor's nearest stations, reports/bogor_stasiun_2026-11-17.json, shown on /validasi).
 */
export function indicativeNote(label: string): string {
  return `Indikatif: ${label} belum punya titik ukur di dalam kota, jadi latar polusinya dari model global dan kalibrasi Jabodetabek. ` +
    'Di stasiun terdekat (Cibinong, Sentul City) latar itu tidak mengikuti naik-turun harian, jadi angka mutlaknya belum bisa dipercaya. ' +
    'Urutan antarfasilitas (asap kendaraan dari jalan sekitar, rumus yang sama dengan peta) tetap bisa dibandingkan.';
}
