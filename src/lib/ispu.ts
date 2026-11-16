/**
 * Indeks Standar Pencemar Udara (ISPU), Peraturan Menteri LHK P.14/MENLHK/SETJEN/KUM.1/7/2020
 * (Berita Negara 2020 No. 774, https://peraturan.go.id/files/bn774-2020.pdf).
 *
 * Lampiran I.A, Tabel Konversi: concentration (µg/m³, 24-hour basis in the table header) at ISPU 50, 100, 200, 300 and 500.
 * Lampiran I.B, equation (1): I = (Ia - Ib) / (Xa - Xb) * (Xx - Xb) + Ib.
 * Lampiran II.A: Baik 1-50 hijau, Sedang 51-100 biru, Tidak Sehat 101-200 kuning, Sangat Tidak Sehat 201-300 merah,
 * Berbahaya >= 301 hitam.
 */

export type IspuParam = 'pm10' | 'pm25' | 'so2' | 'co' | 'o3' | 'no2' | 'hc';

const ISPU_STEPS = [0, 50, 100, 200, 300, 500] as const;

/** Concentration at ISPU 50, 100, 200, 300, 500 (Lampiran I.A). */
export const ISPU_TABLE: Record<IspuParam, readonly [number, number, number, number, number]> = {
  pm10: [50, 150, 350, 420, 500],
  pm25: [15.5, 55.4, 150.4, 250.4, 500],
  so2: [52, 180, 400, 800, 1200],
  co: [4000, 8000, 15000, 30000, 45000],
  o3: [120, 235, 400, 800, 1000],
  no2: [80, 200, 1130, 2260, 3000],
  hc: [45, 100, 215, 432, 648],
};

/** ISPU of a concentration, unrounded; capped at 500 above the top of the table; null for invalid input. */
export function ispu(param: IspuParam, conc: number): number | null {
  if (!Number.isFinite(conc) || conc < 0) return null;
  const x = [0, ...ISPU_TABLE[param]];
  for (let k = 1; k < x.length; k++) {
    if (conc <= x[k]) {
      const [xb, xa, ib, ia] = [x[k - 1], x[k], ISPU_STEPS[k - 1], ISPU_STEPS[k]];
      return ((ia - ib) / (xa - xb)) * (conc - xb) + ib;
    }
  }
  return 500;
}

/** ISPU as reported: rounded to a whole number (Lampiran I, worked example: 69,92 -> 70). */
export function ispuRounded(param: IspuParam, conc: number): number | null {
  const v = ispu(param, conc);
  return v === null ? null : Math.round(v);
}

export interface IspuCategory { name: string; color: string; colorName: string; range: string; min: number; advice: string }

/** Lampiran II.A (colours: green, blue, yellow, red, black as named) and II.B (advice, shortened). */
export const ISPU_CATEGORIES: readonly IspuCategory[] = [
  { name: 'Baik', colorName: 'Hijau', color: '#16a34a', range: '1–50', min: 0,
    advice: 'Sangat baik untuk kegiatan di luar.' },
  { name: 'Sedang', colorName: 'Biru', color: '#2563eb', range: '51–100', min: 51,
    advice: 'Kelompok sensitif: kurangi aktivitas fisik yang terlalu lama atau berat.' },
  { name: 'Tidak Sehat', colorName: 'Kuning', color: '#eab308', range: '101–200', min: 101,
    advice: 'Kelompok sensitif: rehat lebih sering dan amati gejala. Setiap orang: kurangi aktivitas lama di luar.' },
  { name: 'Sangat Tidak Sehat', colorName: 'Merah', color: '#dc2626', range: '201–300', min: 201,
    advice: 'Kelompok sensitif: hindari semua aktivitas di luar. Setiap orang: hindari aktivitas fisik lama di luar.' },
  { name: 'Berbahaya', colorName: 'Hitam', color: '#111827', range: '≥ 301', min: 301,
    advice: 'Kelompok sensitif: tetap di dalam ruangan. Setiap orang: hindari semua aktivitas di luar.' },
];

export function ispuCategory(value: number): IspuCategory {
  const v = Math.round(value);
  let cat = ISPU_CATEGORIES[0];
  for (const c of ISPU_CATEGORIES) if (v >= c.min) cat = c;
  return cat;
}

/** Category of a PM2.5 concentration, the usual critical parameter. */
export function pm25Category(pm25: number): IspuCategory {
  return ispuCategory(ispu('pm25', pm25) ?? 0);
}
