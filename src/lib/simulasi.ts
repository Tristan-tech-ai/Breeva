/** Closure simulation file of a region (scripts/field/simulate-closure.mts, task F4-02) and its one-line text. */
export interface SimulasiSekolah {
  id: string;
  status: 'ok' | 'jalan_putar_jauh' | 'tanpa_jalan_putar' | 'jalan_utama' | 'tanpa_jalan';
  teks: string;
  perubahan_persen?: number;
}
export interface SimulasiFile {
  wilayah: string;
  kondisi: { jam_lokal: number; angin_m_s: number; stabilitas: string; catatan: string };
  sekolah: SimulasiSekolah[];
}

/** The script already writes the sentence; a school without a usable result says why. */
export function simulasiLine(s: SimulasiSekolah): string {
  return s.teks || 'Belum ada hasil simulasi untuk sekolah ini.';
}
