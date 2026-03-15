import type { SupabaseClient } from '@supabase/supabase-js';
import { makeReportsForUser } from '../factories/reportFactory';
import { randomBetween } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';
import type { City } from '../data/city-locations';

/** Report count ranges per tier: power users contribute most */
const REPORT_COUNTS: Record<string, [number, number]> = {
  power: [10, 20],
  active: [4, 8],
  casual: [0, 2],
  new: [0, 1],
  dormant: [1, 3],
};

/** Days back per tier for contribution heatmap coverage */
const REPORT_DAYS: Record<string, number> = {
  power: 365,
  active: 180,
  casual: 30,
  new: 7,
  dormant: 60,
};

export class ReportSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const [lo, hi] = REPORT_COUNTS[userData.tier] ?? [0, 2];
      const count = randomBetween(lo, hi);
      if (count === 0) continue;

      const reports = makeReportsForUser(
        userId,
        userData.city as City,
        count,
        REPORT_DAYS[userData.tier] ?? 30,
      );

      const { error } = await this.sb.from('air_quality_reports').insert(
        reports.map((r) => ({
          user_id: r.user_id,
          lat: r.lat,
          lng: r.lng,
          aqi_rating: r.aqi_rating,
          description: r.description,
          photo_url: r.photo_url,
          confidence_score: r.confidence_score,
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
