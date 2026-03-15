import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSeedData } from '../factories/userFactory';

/**
 * Checks each user's stats against achievement requirements
 * and inserts qualifying unlocks into user_achievements.
 */
export class AchievementSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    // Fetch all achievements
    const { data: achievements, error: aErr } = await this.sb
      .from('achievements')
      .select('id, requirement_type, requirement_value')
      .eq('is_active', true);

    if (aErr || !achievements?.length) {
      console.error(`   ✗ Could not load achievements: ${aErr?.message ?? 'none found'}`);
      return { count: 0 };
    }

    let total = 0;

    for (const [userId, userData] of userMap) {
      const qualifying = achievements.filter((a) => {
        switch (a.requirement_type) {
          case 'walks':
            return userData.total_walks >= a.requirement_value;
          case 'total_distance':
            // User stats are in km, achievement is in meters
            return userData.total_distance_km * 1000 >= a.requirement_value;
          case 'streak':
            return userData.longest_streak >= a.requirement_value;
          case 'co2_saved':
            return userData.total_co2_saved_grams >= a.requirement_value;
          case 'total_points':
            return userData.ecopoints_balance >= a.requirement_value;
          default:
            return false;
        }
      });

      if (qualifying.length === 0) continue;

      const rows = qualifying.map((a) => ({
        user_id: userId,
        achievement_id: a.id,
      }));

      const { error } = await this.sb
        .from('user_achievements')
        .upsert(rows, { onConflict: 'user_id,achievement_id' });

      if (error) {
        console.error(`   ✗ Achievements for ${userData.email}: ${error.message}`);
      } else {
        total += qualifying.length;
      }
    }

    console.log(`   + Inserted ${total} achievement unlocks`);
    return { count: total };
  }
}
