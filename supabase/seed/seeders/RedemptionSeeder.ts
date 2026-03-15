import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRedemption } from '../factories/redemptionFactory';
import { randomBetween, randomFrom } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';

export class RedemptionSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    userMap: Map<string, UserSeedData>,
    rewards: Array<{ id: string; merchant_id: string; points_cost: number }>
  ): Promise<{ count: number }> {
    let total = 0;

    // Only power & active users redeem rewards
    const eligible = [...userMap.entries()].filter(
      ([, u]) => u.tier === 'power' || u.tier === 'active'
    );

    for (const [userId, userData] of eligible) {
      const count = userData.tier === 'power' ? randomBetween(2, 4) : randomBetween(0, 2);
      if (count === 0) continue;

      // Pick random rewards to redeem
      const chosen = Array.from({ length: count }, () => randomFrom(rewards));

      for (const reward of chosen) {
        const redemption = makeRedemption(
          userId,
          reward.id,
          reward.merchant_id,
          reward.points_cost
        );

        const { error } = await this.sb.from('redeemed_rewards').insert({
          user_id: redemption.user_id,
          reward_id: redemption.reward_id,
          merchant_id: redemption.merchant_id,
          points_spent: redemption.points_spent,
          status: redemption.status,
          qr_code: redemption.qr_code,
          backup_code: redemption.backup_code,
          used_at: redemption.used_at,
          expires_at: redemption.expires_at,
        });

        if (error) {
          console.error(`   ✗ Redemption for ${userData.email}: ${error.message}`);
        } else {
          total++;
        }
      }
    }

    console.log(`   + Inserted ${total} reward redemptions`);
    return { count: total };
  }
}
