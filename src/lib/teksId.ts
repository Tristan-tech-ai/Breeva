/**
 * Indonesian display text for rows the database stores in English (seeded achievements, merchant categories, older
 * points-transaction descriptions). The rows stay as they are; only what the app shows is translated (N-57).
 */

const PENCAPAIAN: Record<string, { nama: string; deskripsi: string }> = {
  'First Walk': { nama: 'Jalan Pertama', deskripsi: 'Selesaikan jalan kaki pertamamu' },
  'Week Warrior': { nama: 'Pejuang Sepekan', deskripsi: 'Jaga jalan beruntun 7 hari' },
  'Month Master': { nama: 'Juara Sebulan', deskripsi: 'Jaga jalan beruntun 30 hari' },
  'Point Collector': { nama: 'Pengumpul Poin', deskripsi: 'Kumpulkan 500 EcoPoin' },
  'Point Master': { nama: 'Ahli Poin', deskripsi: 'Kumpulkan 2.000 EcoPoin' },
  'Eco Champion': { nama: 'Juara Hijau', deskripsi: 'Hemat 1 kg CO₂ dengan berjalan kaki' },
  'Carbon Crusher': { nama: 'Penakluk Karbon', deskripsi: 'Hemat 10 kg CO₂ dengan berjalan kaki' },
  '5K Club': { nama: 'Klub 5K', deskripsi: 'Jalan kaki total 5 kilometer' },
  '10K Master': { nama: 'Ahli 10K', deskripsi: 'Jalan kaki total 10 kilometer' },
  'Marathon Hero': { nama: 'Pahlawan Maraton', deskripsi: 'Jalan kaki total 42,195 kilometer' },
};

/** Achievement name in Indonesian; unknown names are shown as stored. */
export function namaPencapaian(name: string | null | undefined): string {
  if (!name) return '';
  return PENCAPAIAN[name.trim()]?.nama ?? name;
}

/** Achievement description in Indonesian, keyed by the stored English name. */
export function deskripsiPencapaian(name: string | null | undefined, description: string | null | undefined): string {
  const hit = name ? PENCAPAIAN[name.trim()] : undefined;
  return hit?.deskripsi ?? description ?? '';
}

const KATEGORI: Record<string, string> = {
  All: 'Semua',
  'Café': 'Kafe',
  Cafe: 'Kafe',
  'Eco Products': 'Produk ramah lingkungan',
  'Repair Shop': 'Bengkel reparasi',
  'Thrift Store': 'Barang bekas',
  'Refill Station': 'Isi ulang',
  Market: 'Pasar',
  Vegan: 'Vegan',
  Books: 'Buku',
  General: 'Umum',
};

/** Merchant category label in Indonesian; the stored value stays the filter key. */
export function kategoriMerchant(category: string | null | undefined): string {
  if (!category) return KATEGORI.General;
  return KATEGORI[category.normalize('NFC').trim()] ?? category;
}

const TRANSAKSI: [RegExp, string][] = [
  [/^welcome bonus for completing onboarding$/i, 'Bonus selamat datang'],
  [/^daily login bonus\b/i, 'Bonus harian'],
  [/^achievement unlocked\b/i, 'Pencapaian terbuka'],
  [/^quest completed\b/i, 'Misi selesai'],
  [/^redeemed reward\b|^reward redeemed$/i, 'Hadiah ditukar'],
  [/^aq report reward\b/i, 'Laporan kualitas udara'],
  [/^earned \d+ pts from walk$/i, 'Jalan kaki'],
  [/^streak bonus\b/i, 'Bonus beruntun'],
];

/** Points-transaction description in Indonesian; descriptions already in Indonesian pass through. */
export function teksTransaksi(description: string | null | undefined, type: string): string {
  const d = (description ?? '').trim();
  if (!d) { const t = type.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }
  for (const [re, id] of TRANSAKSI) if (re.test(d)) return id;
  return d;
}

/** Decimal points to commas in quest text such as 'Jalan kaki 1.25 km' (the template stores a dot). */
export function desimalId(text: string | null | undefined): string {
  return (text ?? '').replace(/(\d+)\.(\d+)(?=\s?(km|m|kg)\b)/g, '$1,$2');
}

/** A merchant a tester registered with a placeholder name and no reviews; hidden from the public list (row kept). */
export function merchantPercobaan(m: { name?: string | null; review_count?: number | null }): boolean {
  return /^(test|tes|testing|coba|percobaan)$/i.test((m.name ?? '').trim()) && !(m.review_count && m.review_count > 0);
}

/** Shown above the merchant and reward lists: the seeded merchants are demo data, not real partnerships. */
export const CATATAN_CONTOH_MERCHANT =
  'Merchant dan hadiah di sini masih data contoh untuk peragaan EcoPoin; belum ada kerja sama dengan usaha nyata.';
