/**
 * Road card of the static field (M-U01, replaces the large Leaflet popup): three short lines when closed (road name,
 * the number of the active map mode with its category, one hour advice), the technical numbers behind "Rincian".
 * Pure functions plus two window events; no Leaflet and no React here.
 */
import { ispuCategory, ispuRounded, pm25Category } from '../ispu';
import { formatAngka } from '../angka';
import { trafficColor, trafficPollutant } from '../roadColors';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { CellValue } from './cells';
import { HARGA_COLORS, HARGA_LABELS } from './harga';
import { interval95 } from './popup';
import type { SeriesPoint } from './roadSeries';
import { ageLabel, type FieldSource } from './source';

type KartuSource = Pick<FieldSource, 'ageHours' | 'isStale' | 'manifest' | 'harga'>;

export interface KartuRuasData {
  /** road name, or "Ruas tanpa nama" */
  judul: string;
  /** main number of the active mode, with its unit: "7,3 µg/m³", "ISPU 51", "2,1×" */
  utama: string;
  /** what the number is and its plain category: "asap kendaraan · sedang", "PM2,5 · Sedang" */
  kategori: string;
  warna: string;
  indikatif: boolean;
  /** detail sentences behind "Rincian" */
  rincian: string[];
}

const ASAP_BATAS: Record<'pm25' | 'no2' | 'pm10', [number, number, number, number]> = {
  no2: [2, 5, 15, 40], pm25: [1, 2, 4, 8], pm10: [2, 4, 8, 16],
};
const ASAP_KATA = ['hampir tidak ada', 'sedikit', 'sedang', 'banyak', 'sangat banyak'];

/** Plain words for the exhaust part of a road (the same breaks as the traffic colour scale). */
export function kategoriAsap(pollutant: 'pm25' | 'no2' | 'pm10', delta: number): string {
  const b = ASAP_BATAS[pollutant];
  return ASAP_KATA[b.filter((x) => delta >= x).length];
}

export function kartuRuas(
  v: CellValue | undefined, name: string | undefined, src: KartuSource, c: number, i: number,
  pollutant: PollutantType, mode: RoadDisplayMode,
): KartuRuasData {
  const judul = name?.trim() || 'Ruas tanpa nama';
  const indikatif = !!src.manifest?.indicative;
  if (!v) return { judul, utama: 'Angka ruas ini sedang dimuat', kategori: '', warna: '#cbd5e1', indikatif, rincian: [] };
  const band = pm25Category(v.pm25);
  const index = ispuRounded('pm25', v.pm25) ?? 0;
  const h = src.harga?.value(c, i);
  const hargaKlass = h != null && src.harga ? src.harga.klass(h) : null;

  let utama: string, kategori: string, warna: string;
  if (mode === 'traffic') {
    const p = trafficPollutant(pollutant);
    const d = p === 'no2' ? v.no2_delta : v.pm25_delta;
    utama = `${formatAngka(d, 1, 1)} µg/m³`;
    kategori = `asap kendaraan · ${kategoriAsap(p, d)}`;
    warna = trafficColor(p, d);
  } else if (mode === 'harga' && h != null && hargaKlass) {
    utama = `${formatAngka(h, 1, 2)}× median`;
    kategori = `harga hirup · ${HARGA_LABELS[hargaKlass]}`;
    warna = HARGA_COLORS[hargaKlass];
  } else if (pollutant === 'no2') {
    const idx = ispuRounded('no2', v.no2);
    utama = `${formatAngka(v.no2, 0, 0)} µg/m³`;
    kategori = idx == null ? 'NO₂' : `NO₂ · ${ispuCategory(idx).name}`;
    warna = idx == null ? '#cbd5e1' : ispuCategory(idx).color;
  } else if (pollutant === 'aqi') {
    utama = `ISPU ${index}`;
    kategori = `udara total · ${band.name}`;
    warna = band.color;
  } else {
    utama = `${formatAngka(v.pm25, 1, 1)} µg/m³`;
    kategori = `PM2,5 · ${band.name}`;
    warna = band.color;
  }

  const [lo, hi] = interval95(v, src.manifest?.measurement?.method);
  const p = trafficPollutant(pollutant);
  const rincian = [
    `Udara total di ruas ini: PM2,5 ${formatAngka(v.pm25, 1, 1)} µg/m³ (ISPU ${index}, ${band.name}); rentang 95%: ${formatAngka(lo, 0, 0)}–${formatAngka(hi, 0, 0)} µg/m³.`,
    `Dari knalpot di ruas ini: NO₂ +${formatAngka(v.no2_delta, 1, 1)} µg/m³ dan PM2,5 +${formatAngka(v.pm25_delta, 1, 2)} µg/m³ (asap kendaraan ${kategoriAsap(p, p === 'no2' ? v.no2_delta : v.pm25_delta)}). ` +
      'Perkiraan model dari kelas jalan, pola jam, dan angin; belum diuji di pinggir jalan.',
  ];
  if (h != null && hargaKlass) rincian.push(`Harga hirup ${formatAngka(h, 1, 2)}× median wilayah (${HARGA_LABELS[hargaKlass]}): berapa banyak orang di sekitar ruas ini ikut menghirup asapnya.`);
  if (v.ood) rincian.push('Di luar rentang data model, jadi angkanya lebih kasar.');
  if (indikatif) rincian.push('Indikatif: belum ada titik ukur di wilayah ini.');
  rincian.push(`Dihitung ${ageLabel(src.ageHours())}${src.isStale() ? ' (data lama)' : ''}.`);
  return { judul, utama, kategori, warna, indikatif, rincian };
}

/** One sentence on the hour with the least exhaust among the hours the run published. */
export function saranJam(pts: SeriesPoint[]): string {
  if (pts.length < 2) return '';
  const lo = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const now = pts[0].value;
  const pct = now > 0 ? Math.round((1 - lo.value / now) * 100) : 0;
  return lo.ahead > 0 && pct >= 10
    ? `Asap paling sedikit pukul ${String(lo.local_hour).padStart(2, '0')}.00 (−${pct}%)`
    : 'Jam ini termasuk yang paling sedikit asapnya';
}

// ---- events between the map layer (FieldLayer) and the card (KartuRuas) ----

export const KARTU_BUKA = 'breeva:kartu-ruas';
export const KARTU_TUTUP = 'breeva:kartu-ruas-tutup';

export interface KartuDetail {
  /** road identity: the same id keeps the loaded hours and the open details (mode change redraws the card) */
  id: string;
  kartu: KartuRuasData;
  /** the road's next hours, loaded only when the card opens */
  seri?: () => Promise<{ pts: SeriesPoint[]; svg: string }>;
}

let terbuka = false;

export function kartuTerbuka(): boolean {
  return terbuka;
}

export function bukaKartu(d: KartuDetail): void {
  terbuka = true;
  window.dispatchEvent(new CustomEvent<KartuDetail>(KARTU_BUKA, { detail: d }));
}

export function tutupKartu(): void {
  if (!terbuka) return;
  terbuka = false;
  window.dispatchEvent(new Event(KARTU_TUTUP));
}
