import { randomBetween, randomDateStr, randomFrom } from '../utils/helpers';
import { REWARD_TEMPLATES, type RewardTemplate } from '../data/merchant-templates';

export interface RewardSeedData {
  merchant_id: string;
  title: string;
  description: string;
  terms_conditions: string;
  discount_percentage: number | null;
  discount_amount: number | null;
  points_required: number;
  total_stock: number;
  remaining_stock: number;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
}

/**
 * Generate 1-2 rewards per merchant based on its category.
 */
export function makeRewardsForMerchant(
  merchantId: string,
  merchantCategory: string,
): RewardSeedData[] {
  const templates = REWARD_TEMPLATES[merchantCategory];
  if (!templates || templates.length === 0) return [];

  // Pick 1-2 rewards from available templates for this category
  const count = Math.min(templates.length, randomBetween(1, 2));
  const picked: RewardTemplate[] = [];
  const pool = [...templates];
  for (let i = 0; i < count; i++) {
    const idx = randomBetween(0, pool.length - 1);
    picked.push(pool.splice(idx, 1)[0]);
  }

  return picked.map((t) => {
    const totalStock = randomBetween(20, 200);
    const used = randomBetween(0, Math.floor(totalStock * 0.6));
    return {
      merchant_id: merchantId,
      title: t.title,
      description: t.description,
      terms_conditions: t.terms,
      discount_percentage: t.discountPct ?? null,
      discount_amount: t.discountAmount ?? null,
      points_required: t.points,
      total_stock: totalStock,
      remaining_stock: totalStock - used,
      valid_from: '2026-03-01',
      valid_until: randomDateStr(30, 120),
      is_active: true,
    };
  });
}
