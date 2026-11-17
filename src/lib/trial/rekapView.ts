/** Rows of the teacher's tally page /uji-coba/rekap (task F4-09). Pure, tested. */
import type { Rekap } from './diary';

export const G4_MIN_STUDENTS = 15, G4_MIN_DAYS = 5;

export interface Row { label: string; value: string }

const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x)}%`);

export function rekapRows(r: Rekap): Row[] {
  const pass = r.peserta_min_5_hari >= G4_MIN_STUDENTS;
  return [
    { label: 'Kode terbaca', value: `${r.kode_terbaca}${r.kode_ditolak ? ` (${r.kode_ditolak} ditolak: salah ketik atau terpotong)` : ''}` },
    { label: 'Peserta (ponsel berbeda)', value: String(r.peserta) },
    { label: `Peserta yang memakai ≥ ${G4_MIN_DAYS} hari (gerbang G4: minimal ${G4_MIN_STUDENTS})`, value: `${r.peserta_min_5_hari}: ${pass ? 'lulus' : 'belum lulus'}` },
    { label: 'Hari memakai rute per peserta', value: r.hari_per_peserta.length ? r.hari_per_peserta.join(', ') : '–' },
    { label: 'Median pengurangan asap kendaraan yang ditawarkan rute jalan kaki', value: pct(r.median_pengurangan_asap_pct) },
    { label: 'Median tambahan waktu rute itu', value: r.median_tambahan_menit == null ? '–' : `${Math.round(r.median_tambahan_menit)} menit` },
    { label: 'Moda (peserta)', value: `jalan kaki ${r.moda.jalan_kaki}, motor ${r.moda.motor}` },
    { label: 'Wilayah (peserta)', value: `Badung–Denpasar ${r.wilayah.badung_denpasar}, Kota Bogor ${r.wilayah.kota_bogor}` },
    { label: 'Jendela tanggal', value: `${r.jendela[0]} s.d. ${r.jendela[1]}` },
  ];
}

/** A YYYY-MM-DD pair in order, or null. */
export function windowOf(from: string, to: string): [string, string] | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  return ok(from) && ok(to) && from <= to ? [from, to] : null;
}
