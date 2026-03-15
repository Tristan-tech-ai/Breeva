import type { SupabaseClient } from '@supabase/supabase-js';
import { makeReviewsForMerchant } from '../factories/reviewFactory';
import { randomBetween } from '../utils/helpers';

export class ReviewSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    userIds: string[],
    merchantList: Array<{ id: string; category: string }>,
  ): Promise<{ count: number }> {
    let total = 0;

    for (const merchant of merchantList) {
      const reviewCount = randomBetween(2, 6);
      const reviews = makeReviewsForMerchant(merchant.id, userIds, reviewCount);

      for (const review of reviews) {
        const { error } = await this.sb.from('reviews').upsert(
          {
            user_id: review.user_id,
            merchant_id: review.merchant_id,
            rating: review.rating,
            comment: review.comment,
            created_at: review.created_at,
          },
          { onConflict: 'user_id,merchant_id' },
        );

        if (error) {
          // Duplicate user+merchant is expected, skip silently
          if (!error.message.includes('duplicate')) {
            console.error(`   ✗ Review for merchant ${merchant.id}: ${error.message}`);
          }
        } else {
          total++;
        }
      }
    }

    console.log(`   + Inserted ${total} merchant reviews`);
    return { count: total };
  }
}
