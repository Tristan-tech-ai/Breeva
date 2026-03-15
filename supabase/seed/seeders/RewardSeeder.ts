import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRewardsForMerchant } from '../factories/rewardFactory';

export class RewardSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    merchants: Array<{ id: string; category: string }>
  ): Promise<{ count: number; rewards: Array<{ id: string; merchant_id: string; points_cost: number }> }> {
    const allRewards: Array<{ id: string; merchant_id: string; points_cost: number }> = [];
    type RewardRow = { id: string; merchant_id: string; points_required: number };

    for (const m of merchants) {
      const rewards = makeRewardsForMerchant(m.id, m.category);

      for (const r of rewards) {
        const { data, error } = await this.sb
          .from('rewards')
          .insert({
            merchant_id: r.merchant_id,
            title: r.title,
            description: r.description,
            points_required: r.points_required,
            discount_percentage: r.discount_percentage,
            discount_amount: r.discount_amount,
            terms_conditions: r.terms_conditions,
            is_active: r.is_active,
            total_stock: r.total_stock,
            remaining_stock: r.remaining_stock,
            valid_from: r.valid_from,
            valid_until: r.valid_until,
          })
          .select('id, merchant_id, points_required')
          .single();

        if (error) {
          console.error(`   ✗ Reward "${r.title}": ${error.message}`);
        } else if (data) {
          const row = data as unknown as RewardRow;
          allRewards.push({ id: row.id, merchant_id: row.merchant_id, points_cost: row.points_required });
        }
      }
    }

    console.log(`   + Inserted ${allRewards.length} rewards across ${merchants.length} merchants`);
    return { count: allRewards.length, rewards: allRewards };
  }
}
