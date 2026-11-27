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
    judul: `${k.kota} 2027, usulan sensor ke-${t.peringkat}: ${t.nama}`,
    kalimat: `Belum ada sensor di sini. Sensor di titik ini mengurangi kebutaan peta kota ini sekitar ${formatAngka(t.manfaat_pct, 1, 1)}%. Indikatif (perkiraan): cara memilih titik belum lolos uji kami.`,
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

/**
 * M-U14 (Tristan, 27 Nov): a PROPOSED sensor point must not look like a station that exists. Its marker is hollow with
 * a dashed rim (a plus in the app layer, the rank on /sensor/titik); the sensors that exist are the filled blue dots.
 */
export function ikonUsulan(isi: string, o: { ukuran?: number; aktif?: boolean } = {}): string {
  const u = o.ukuran ?? 24;
  const warna = o.aktif ? '#0f172a' : '#15803d';
  return `<span aria-hidden="true" data-usulan-sensor style="display:block;box-sizing:border-box;width:${u}px;height:${u}px;border-radius:9999px;`
    + `border:2px dashed ${warna};background:rgba(255,255,255,.92);color:${warna};font:700 ${Math.round(u * 0.5)}px/${u - 4}px system-ui;`
    + `text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.25)">${isi}</span>`;
}

/** Kab/kota whose blindness is drawn from the pilot's own 250 m image, so the national polygon is not laid over it. */
export const SLUG_KABUT_PILOT: readonly string[] = ['kota-bogor', 'kabupaten-badung', 'kota-denpasar'];

/**
 * M-U14: the kab/kota the map is blind in, for the national fog: every one without a sensor within 25 km (the level
 * 'terukur' of v/nasional/latar.json is the only one with a measurement, kabkota.ts TINGKAT_NILAI), minus those drawn
 * from a pilot image.
 */
export function slugButa(wilayah: Record<string, { t: string }>, kecuali: readonly string[] = SLUG_KABUT_PILOT): Set<string> {
  const out = new Set<string>();
  for (const [slug, w] of Object.entries(wilayah)) if (w.t !== 'terukur' && !kecuali.includes(slug)) out.add(slug);
  return out;
}

/** The one line that says what the layer shows. */
export const LEGENDA_BUTA = 'Hijau: sudah ada alat ukur di dekatnya (sensor warga atau stasiun). Jingga: peta buta. Titik biru: sensor dan stasiun yang ada. Lingkaran putus-putus: usulan sensor baru (angka = urutan prioritas).';

/** T9 (Tristan, 27 Nov): covered places are green, not left white. Kab/kota with a sensor within 25 km ('terukur'). */
export function slugTerukur(wilayah: Record<string, { t: string }>, kecuali: readonly string[] = SLUG_KABUT_PILOT): Set<string> {
  const out = new Set<string>();
  for (const [slug, w] of Object.entries(wilayah)) if (w.t === 'terukur' && !kecuali.includes(slug)) out.add(slug);
  return out;
}

/** One proposed sensor point on the app layer. grup = the city or region it belongs to ('nasional' for a kab/kota centre). */
export interface Usulan {
  lat: number; lon: number; grup: string; peringkat: number; nama?: string;
  judul: string; kalimat: string; tautan: string; teksTautan: string;
  /** national rank of a kab/kota centre (1 = the most people moved from indicative to measured), else undefined */
  urutanNasional?: number;
}
export interface PenandaUsulan { lat: number; lon: number; teks: string; judul: string; kalimat: string; tautan: string; teksTautan: string; perbesar?: boolean }

/** From this zoom every point of a city shows with its rank; below it one marker per city with the count. */
export const ZOOM_TITIK_KOTA = 11;
/** From this zoom every blind kab/kota shows its own proposal; below it only the national top 30. */
export const ZOOM_SEMUA_KABKOTA = 8;
export const TOP_NASIONAL = 30;

/**
 * T9 (Tristan, 27 Nov: "the sensors sit on top of each other; if they are all crammed together why compute them", and "many
 * blind places have no proposal"): what the layer draws at a zoom. City points: one marker per city with their count when
 * zoomed out (a tap zooms in), each point with its rank from ZOOM_TITIK_KOTA. Kab/kota centres: the national top 30 at any
 * zoom, every blind kab/kota from ZOOM_SEMUA_KABKOTA. Pure, tested.
 */
export function usulanUntukZoom(daftar: readonly Usulan[], zoom: number): PenandaUsulan[] {
  const out: PenandaUsulan[] = [];
  const kota = new Map<string, Usulan[]>();
  for (const u of daftar) {
    if (u.grup === 'nasional') {
      if (zoom >= ZOOM_SEMUA_KABKOTA || (u.urutanNasional != null && u.urutanNasional <= TOP_NASIONAL)) {
        out.push({ lat: u.lat, lon: u.lon, teks: '+', judul: u.judul, kalimat: u.kalimat, tautan: u.tautan, teksTautan: u.teksTautan });
      }
      continue;
    }
    const l = kota.get(u.grup); if (l) l.push(u); else kota.set(u.grup, [u]);
  }
  for (const [grup, l] of kota) {
    const urut = [...l].sort((a, b) => a.peringkat - b.peringkat);
    if (zoom >= ZOOM_TITIK_KOTA || urut.length === 1) {
      for (const u of urut) out.push({ lat: u.lat, lon: u.lon, teks: String(u.peringkat), judul: u.judul, kalimat: u.kalimat, tautan: u.tautan, teksTautan: u.teksTautan });
    } else {
      const u = urut[0];
      out.push({ lat: u.lat, lon: u.lon, teks: String(urut.length), judul: `${urut.length} usulan sensor di ${grup}`,
        kalimat: `Ketuk untuk memperbesar dan melihat tiap titik. Yang pertama paling berguna: ${u.nama ?? u.judul}.`, tautan: u.tautan, teksTautan: u.teksTautan, perbesar: true });
    }
  }
  return out;
}

/** Distance in km between two points (for leaving out a kab/kota centre near a city that already has its own points). */
export function kmAntara(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  return 6371 * Math.hypot((b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), (b.lat - a.lat) * r);
}


/**
 * T9 (Tristan, 27 Nov: "what is already reached by a station or a sensor should be green"): kab/kota whose centre has a
 * monitoring station (WAQI: government and other networks) within `km`. The map's numbers do not use those stations
 * (licence), but the place is not blind: someone measures there.
 */
export function slugDenganStasiun(kab: ReadonlyArray<{ slug: string; lat: number; lon: number }>, stasiun: ReadonlyArray<{ lat: number; lon: number }>, km = 25): Set<string> {
  const out = new Set<string>();
  for (const k of kab) if (stasiun.some((st) => kmAntara(st, k) <= km)) out.add(k.slug);
  return out;
}


/** Ray casting over every ring of a Polygon or MultiPolygon (holes by the even-odd rule). Coordinates are [lon, lat]. */
export function titikDalamPoligon(lon: number, lat: number, geom: { type: string; coordinates: unknown }): boolean {
  const polys = (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []) as number[][][][];
  let dalam = false;
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dalam = !dalam;
    }
  }
  return dalam;
}

/**
 * T9 (Tristan, 27 Nov: "places that already have a sensor are still orange"): kab/kota whose own polygon holds a station
 * or sensor. Checking only 25 km from the centre left big kabupaten orange around their own station (Palu, Kendari).
 */
export function slugBerisiTitik(fc: { features: Array<{ properties: unknown; geometry: { type: string; coordinates: unknown } | null }> },
  titik: ReadonlyArray<{ lat: number; lon: number }>): Set<string> {
  const out = new Set<string>();
  for (const f of fc.features) {
    const slug = String((f.properties as { s?: string } | null)?.s ?? '');
    if (!slug || !f.geometry) continue;
    if (titik.some((t) => titikDalamPoligon(t.lon, t.lat, f.geometry!))) out.add(slug);
  }
  return out;
}
