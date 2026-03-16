import type { SupabaseClient } from '@supabase/supabase-js';
import { makeLeaderboardForUser, type LeaderboardWeeklyRow } from '../factories/leaderboardFactory';
import type { UserSeedData } from '../factories/userFactory';

/** Number of past weeks to generate per tier */
const WEEKS_BACK: Record<string, number> = {
  power: 12,
  active: 8,
  casual: 6,
  new: 3,
  dormant: 8,
};

export class LeaderboardSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    userMap: Map<string, UserSeedData>,
  ): Promise<{ count: number }> {
    const allRows: LeaderboardWeeklyRow[] = [];

    for (const [userId, userData] of userMap) {
      const weeks = WEEKS_BACK[userData.tier] ?? 6;
      const rows = makeLeaderboardForUser(userId, userData, weeks);
      allRows.push(...rows);
    }

    if (allRows.length === 0) return { count: 0 };

    // Group by week_start to assign ranks per week
    const byWeek = new Map<string, LeaderboardWeeklyRow[]>();
    for (const row of allRows) {
      const arr = byWeek.get(row.week_start) ?? [];
      arr.push(row);
      byWeek.set(row.week_start, arr);
    }

    // Sort each week by points_earned desc and assign rank
    const rankedRows: Array<LeaderboardWeeklyRow & { rank: number }> = [];
    for (const [, weekRows] of byWeek) {
      weekRows.sort((a, b) => b.total_points_earned - a.total_points_earned);
      weekRows.forEach((row, idx) => {
        rankedRows.push({ ...row, rank: idx + 1 });
      });
    }

    // Batch upsert in chunks of 50
    let inserted = 0;
    for (let i = 0; i < rankedRows.length; i += 50) {
      const chunk = rankedRows.slice(i, i + 50);
      const { error } = await this.sb
        .from('leaderboard_weekly')
        .upsert(
          chunk.map((r) => ({
            user_id: r.user_id,
            week_start: r.week_start,
            total_distance_meters: r.total_distance_meters,
            total_walks: r.total_walks,
            total_points_earned: r.total_points_earned,
            rank: r.rank,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'user_id,week_start' },
        );

      if (error) {
        console.error(`   ✗ Leaderboard batch error: ${error.message}`);
      } else {
        inserted += chunk.length;
      }
    }

    console.log(`   ✓ ${inserted} leaderboard entries across ${byWeek.size} weeks`);
    return { count: inserted };
  }
}
