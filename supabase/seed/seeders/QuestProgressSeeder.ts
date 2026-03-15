import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBetween, randomDateStr } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';

/**
 * Generates user_quests progress entries.
 * Uses the 6 quests already seeded in schema.sql.
 */
export class QuestProgressSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    // Fetch existing quests
    const { data: quests, error: qErr } = await this.sb
      .from('quests')
      .select('id, quest_type, target_value, is_daily')
      .eq('is_active', true);

    if (qErr || !quests?.length) {
      console.error(`   ✗ Could not load quests: ${qErr?.message ?? 'none found'}`);
      return { count: 0 };
    }

    let total = 0;

    for (const [userId, userData] of userMap) {
      // Number of quest entries varies by tier
      const questDays =
        userData.tier === 'power'
          ? randomBetween(5, 10)
          : userData.tier === 'active'
            ? randomBetween(3, 6)
            : userData.tier === 'casual'
              ? randomBetween(1, 3)
              : userData.tier === 'dormant'
                ? randomBetween(1, 2)
                : 0; // new users have no quest history

      if (questDays === 0) continue;

      const rows: Array<Record<string, unknown>> = [];

      for (let d = 0; d < questDays; d++) {
        const questDate = randomDateStr(90);

        // Pick 1-3 quests for this day
        const dayQuestCount = randomBetween(1, Math.min(3, quests.length));
        const shuffled = [...quests].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, dayQuestCount);

        for (const q of picked) {
          const isCompleted = Math.random() < (userData.tier === 'power' ? 0.8 : 0.5);
          const currentValue = isCompleted
            ? q.target_value
            : randomBetween(0, q.target_value - 1);

          rows.push({
            user_id: userId,
            quest_id: q.id,
            quest_date: questDate,
            current_value: currentValue,
            is_completed: isCompleted,
            completed_at: isCompleted ? `${questDate}T${String(randomBetween(6, 20)).padStart(2, '0')}:${String(randomBetween(0, 59)).padStart(2, '0')}:00+07:00` : null,
          });
        }
      }

      // Deduplicate on (quest_id, quest_date) — keep first occurrence
      const seen = new Set<string>();
      const deduped = rows.filter((r) => {
        const key = `${r.quest_id}-${r.quest_date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (deduped.length === 0) continue;

      const { error } = await this.sb
        .from('user_quests')
        .upsert(deduped, { onConflict: 'user_id,quest_id,quest_date' });

      if (error) {
        console.error(`   ✗ Quest progress for ${userData.email}: ${error.message}`);
      } else {
        total += deduped.length;
      }
    }

    console.log(`   + Inserted ${total} quest progress entries`);
    return { count: total };
  }
}
