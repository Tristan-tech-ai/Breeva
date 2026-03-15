import type { SupabaseClient } from '@supabase/supabase-js';
import { makeTransactionsForUser } from '../factories/transactionFactory';
import type { UserSeedData } from '../factories/userFactory';

const DAYS_BACK: Record<string, number> = {
  power: 365,
  active: 180,
  casual: 60,
  new: 7,
  dormant: 120,
};

export class TransactionSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const totalSpent = userData.total_ecopoints_earned - userData.ecopoints_balance;
      if (userData.total_ecopoints_earned === 0 && totalSpent === 0) continue;

      const daysBack = DAYS_BACK[userData.tier] ?? 90;
      const transactions = makeTransactionsForUser(
        userId,
        userData.total_ecopoints_earned,
        Math.max(0, totalSpent),
        daysBack,
      );

      // Batch insert in chunks of 50
      for (let i = 0; i < transactions.length; i += 50) {
        const chunk = transactions.slice(i, i + 50);
        const { error } = await this.sb.from('points_transactions').insert(
          chunk.map((t) => ({
            user_id: t.user_id,
            amount: t.amount,
            transaction_type: t.transaction_type,
            description: t.description,
            reference_type: t.reference_type,
            reference_id: t.reference_id,
            created_at: t.created_at,
          }))
        );

        if (error) {
          console.error(`   ✗ Transactions for ${userData.email} chunk ${i}: ${error.message}`);
        } else {
          total += chunk.length;
        }
      }
    }

    console.log(`   + Inserted ${total} points transactions`);
    return { count: total };
  }
}
