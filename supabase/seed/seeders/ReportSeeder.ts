import type { SupabaseClient } from '@supabase/supabase-js';
import { makeReportsForUser } from '../factories/reportFactory';
import { randomBetween } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';

/** Report count ranges per tier: power users contribute most */
const REPORT_COUNTS: Record<string, [number, number]> = {
  power: [5, 10],
  active: [2, 5],
  casual: [0, 2],
  new: [0, 1],
  dormant: [1, 3],
};

export class ReportSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const [lo, hi] = REPORT_COUNTS[userData.tier] ?? [0, 2];
      const count = randomBetween(lo, hi);
      if (count === 0) continue;

      const reports = makeReportsForUser(userId, userData.city, count);

      const { error } = await this.sb.from('air_quality_reports').insert(
        reports.map((r) => ({
          user_id: r.user_id,
          latitude: r.latitude,
          longitude: r.longitude,
          aqi_rating: r.aqi_rating,
          description: r.description,
          photo_url: r.photo_url,
        }))
      );

      if (error) {
        console.error(`   ✗ Reports for ${userData.email}: ${error.message}`);
      } else {
        total += reports.length;
      }
    }

    console.log(`   + Inserted ${total} air quality reports`);
    return { count: total };
  }
}
