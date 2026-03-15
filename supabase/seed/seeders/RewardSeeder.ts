import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRewardsForMerchant } from '../factories/rewardFactory';

export class RewardSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    merchants: Array<{ id: string; category: string }>
  ): Promise<{ count: number; rewards: Array<{ id: string; merchant_id: string; points_cost: number }> }> {
    const allRewards: Array<{ id: string; merchant_id: string; points_cost: number }> = [];

    for (const m of merchants) {
      const rewards = makeRewardsForMerchant(m.id, m.category);

      for (const r of rewards) {
        const { data, error } = await this.sb
          .from('rewards')
          .insert({
            merchant_id: r.merchant_id,
            title: r.title,
            description: r.description,
            points_cost: r.points_cost,
            discount_percentage: r.discount_percentage,
            discount_amount: r.discount_amount,
            terms_conditions: r.terms_conditions,
            is_active: r.is_active,
            total_quantity: r.total_quantity,
            remaining_quantity: r.remaining_quantity,
            valid_from: r.valid_from,
            valid_until: r.valid_until,
          })
          .select('id, merchant_id, points_cost')
          .single();

        if (error) {
          console.error(`   ✗ Reward "${r.title}": ${error.message}`);
        } else if (data) {
          allRewards.push(data);
        }
      }
    }

    console.log(`   + Inserted ${allRewards.length} rewards across ${merchants.length} merchants`);
    return { count: allRewards.length, rewards: allRewards };
  }
}
