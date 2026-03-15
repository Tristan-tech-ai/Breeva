import { randomBetween, randomTimestamp, randomFrom } from '../utils/helpers';

export interface TransactionSeedData {
  user_id: string;
  amount: number;
  transaction_type: string;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

const EARN_TYPES = [
  { type: 'walk_earned', desc: (pts: number) => `Earned ${pts} pts from walk`, ref: 'walk' },
  { type: 'quest_reward', desc: (pts: number) => `Quest completed: +${pts} pts`, ref: 'quest' },
  { type: 'achievement_reward', desc: (pts: number) => `Achievement unlocked: +${pts} pts`, ref: 'achievement' },
  { type: 'daily_bonus', desc: (pts: number) => `Daily login bonus: +${pts} pts`, ref: null },
  { type: 'streak_bonus', desc: (pts: number) => `Streak bonus: +${pts} pts`, ref: null },
  { type: 'contribution_reward', desc: (pts: number) => `AQ report reward: +${pts} pts`, ref: 'report' },
] as const;

const REDEEM_TYPES = [
  { type: 'reward_redeemed', desc: (pts: number) => `Redeemed reward: -${pts} pts`, ref: 'reward' },
] as const;

/**
 * Generate realistic points_transactions for a user over a date range.
 */
export function makeTransactionsForUser(
  userId: string,
  totalEarned: number,
  totalSpent: number,
  daysBack: number,
): TransactionSeedData[] {
  const transactions: TransactionSeedData[] = [];

  // Distribute earned points across multiple transactions
  let remainingEarned = totalEarned;
  while (remainingEarned > 0) {
    const earnType = randomFrom([...EARN_TYPES]);
    const amount = Math.min(
      remainingEarned,
      earnType.type === 'walk_earned' ? randomBetween(5, 25)
        : earnType.type === 'quest_reward' ? randomBetween(10, 30)
        : earnType.type === 'achievement_reward' ? randomBetween(50, 200)
        : randomBetween(5, 15),
    );

    transactions.push({
      user_id: userId,
      amount,
      transaction_type: earnType.type,
      description: earnType.desc(amount),
      reference_type: earnType.ref,
      reference_id: null,
      created_at: randomTimestamp(-daysBack, 0),
    });

    remainingEarned -= amount;
  }

  // Distribute spent points (negative amounts)
  let remainingSpent = totalSpent;
  while (remainingSpent > 0) {
    const amount = Math.min(remainingSpent, randomBetween(30, 150));
    const redeemType = randomFrom([...REDEEM_TYPES]);

    transactions.push({
      user_id: userId,
      amount: -amount,
      transaction_type: redeemType.type,
      description: redeemType.desc(amount),
      reference_type: redeemType.ref,
      reference_id: null,
      created_at: randomTimestamp(-Math.floor(daysBack * 0.7), 0),
    });

    remainingSpent -= amount;
  }

  // Sort by created_at for realistic timeline
  transactions.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return transactions;
}
