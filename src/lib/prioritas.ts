/** Priority list of schools and health facilities (data written by scripts/field/priority.mts). */
import { formatAngka } from './angka';

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
  /** facilities in the OpenStreetMap table, those left out (courses, adult education) and the merged points (X-W88, X-W90) */
  sumber_jumlah?: number;
  dikeluarkan?: Array<{ id: string; nama: string; jenis: string; alasan: string }>;
  digabung?: Array<{ tetap: string; nama: string; digabung: Array<{ id: string; nama: string; alasan: string }> }>;
  /** order against a list computed for another day (X-W89) */
  stabilitas?: { banding_tanggal: string; fasilitas_sama: number; spearman: number; sepuluh_teratas_sama: number };
  fasilitas: Fasilitas[];
}

/** The first Monday-Friday after the local date of `nowLocal` (a Date whose UTC fields hold local time), at 00:00 UTC. */
export function nextSchoolDay(nowLocal: Date): Date {
  const d = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() + 1));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Ranks with ties averaged (1-based). */
function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation (Pearson correlation of the tie-averaged ranks). */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return NaN;
  const ra = ranks(a), rb = ranks(b);
  const m = (a.length + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  return num / Math.sqrt(da * db);
}

/** How many of the first n of one order are among the first n of the other. */
export function topOverlap(a: string[], b: string[], n: number): number {
  const top = new Set(b.slice(0, n));
  return a.slice(0, n).filter((x) => top.has(x)).length;
}

/** How the OpenStreetMap table became the list: courses and adult education left out, gates and repeated points merged. */
export function saringTeks(d: Pick<DaftarPrioritas, 'sumber_jumlah' | 'jumlah' | 'dikeluarkan' | 'digabung'>): string {
  const keluar = d.dikeluarkan?.length ?? 0;
  const gabung = (d.digabung ?? []).reduce((n, m) => n + m.digabung.length, 0);
  const ribu = (n: number) => n.toLocaleString('id-ID');
  const bagian = [
    keluar ? `${ribu(keluar)} tempat kursus, bimbel, dan perguruan tinggi tidak dihitung sebagai sekolah` : '',
    gabung ? `${ribu(gabung)} titik gerbang atau bangunan ganda digabung ke fasilitasnya` : '',
  ].filter(Boolean);
  return `Dari ${ribu(d.sumber_jumlah ?? d.jumlah)} titik OpenStreetMap jadi ${ribu(d.jumlah)} fasilitas: ${bagian.join('; ')}.`;
}

/** The date line of the list: the school day it was computed for, and how little the order moves between days. */
export function tanggalDaftar(d: Pick<DaftarPrioritas, 'tanggal' | 'zona' | 'stabilitas'>): string {
  const hari = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const base = `Contoh hari sekolah: ${hari(d.tanggal)} (${d.zona}), dengan prakiraan angin hari itu dan pola lalu lintas jam kegiatan.`;
  const s = d.stabilitas;
  if (!s || !Number.isFinite(s.spearman)) return base;
  const kata = s.spearman >= 0.9 ? 'Urutan hampir tidak bergantung pada cuaca harian' : 'Urutan ikut berubah dengan cuaca harian';
  return `${base} ${kata}: dibanding daftar ${hari(s.banding_tanggal)}, korelasi peringkat ` +
    `${fmt(s.spearman, 3)} dan ${s.sepuluh_teratas_sama} dari 10 teratas sama.`;
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
/** Rows rendered for the first paint; the rest of PAGE_SIZE follows right after (N-42). */
export const LANGSUNG_PERTAMA = 30;

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
  return formatAngka(x, d, d); // N-42: cached formatter
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
