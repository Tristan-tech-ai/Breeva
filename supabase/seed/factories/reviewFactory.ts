import { randomBetween, randomFrom, randomTimestamp } from '../utils/helpers';

export interface ReviewSeedData {
  user_id: string;
  merchant_id: string;
  rating: number;
  comment: string;
  created_at: string;
}

const POSITIVE_COMMENTS = [
  'Tempatnya nyaman dan ramah lingkungan, suka banget!',
  'Harga terjangkau, produk eco-friendly berkualitas.',
  'Pelayanan sangat baik, pasti balik lagi!',
  'Recommended untuk yang peduli lingkungan.',
  'Senang bisa mendukung bisnis berkelanjutan. Kualitasnya top!',
  'Produknya bagus dan packaging-nya zero waste.',
  'Karyawannya ramah, lokasi strategis.',
  'Sudah langganan di sini, selalu puas.',
  'Banyak pilihan produk eco, harganya fair.',
  'Suka konsep refill-nya, hemat dan ramah bumi!',
];

const NEUTRAL_COMMENTS = [
  'Lumayan, bisa ditingkatkan lagi pelayanannya.',
  'Produk oke tapi pilihan masih terbatas.',
  'Lokasi agak susah dijangkau, tapi worth it.',
  'Harga sedikit lebih mahal, tapi kualitas bagus.',
  'Biasa saja, tidak ada yang spesial.',
];

const NEGATIVE_COMMENTS = [
  'Pelayanan kurang responsif, perlu diperbaiki.',
  'Stok sering kosong, sayang sekali.',
];

/**
 * Generate reviews for a specific merchant from random users.
 */
export function makeReviewsForMerchant(
  merchantId: string,
  userIds: string[],
  count: number,
): ReviewSeedData[] {
  const shuffled = [...userIds].sort(() => Math.random() - 0.5);
  const reviewers = shuffled.slice(0, Math.min(count, userIds.length));

  return reviewers.map((userId) => {
    const rating = randomBetween(3, 5); // Weighted toward positive
    const comments =
      rating >= 4 ? POSITIVE_COMMENTS
        : rating === 3 ? NEUTRAL_COMMENTS
        : NEGATIVE_COMMENTS;

    return {
      user_id: userId,
      merchant_id: merchantId,
      rating,
      comment: randomFrom(comments),
      created_at: randomTimestamp(-180, 0),
    };
  });
}
