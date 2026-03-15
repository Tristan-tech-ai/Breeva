import type { SupabaseClient } from '@supabase/supabase-js';
import { makeWalksForUser } from '../factories/walkFactory';
import { randomBetween } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';

/** Walk count ranges per user tier */
const WALK_COUNTS: Record<string, [number, number]> = {
  power: [25, 35],
  active: [10, 20],
  casual: [3, 8],
  new: [0, 2],
  dormant: [5, 10],
};

export class WalkSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(
    userMap: Map<string, UserSeedData>
  ): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const [lo, hi] = WALK_COUNTS[userData.tier] ?? [2, 5];
      const count = randomBetween(lo, hi);
      if (count === 0) continue;

      const daysBack = userData.tier === 'dormant' ? 120 : 90;
      const walks = makeWalksForUser(userId, userData.city, count, daysBack);

      // Batch insert in chunks of 25
      for (let i = 0; i < walks.length; i += 25) {
        const chunk = walks.slice(i, i + 25);
        const { error } = await this.sb.from('walks').insert(
          chunk.map((w) => ({
            user_id: w.user_id,
            started_at: w.started_at,
            completed_at: w.completed_at,
            duration_minutes: w.duration_minutes,
            distance_meters: w.distance_meters,
            steps_count: w.steps_count,
            avg_speed_kmh: w.avg_speed_kmh,
            start_latitude: w.start_latitude,
            start_longitude: w.start_longitude,
            end_latitude: w.end_latitude,
            end_longitude: w.end_longitude,
            avg_aqi: w.avg_aqi,
            min_aqi: w.min_aqi,
            max_aqi: w.max_aqi,
            ecopoints_earned: w.ecopoints_earned,
            co2_saved_grams: w.co2_saved_grams,
            route_geojson: w.route_geojson,
            status: w.status,
          }))
        );

        if (error) {
          console.error(`   ✗ Walks for ${userData.email} chunk ${i}: ${error.message}`);
        } else {
          total += chunk.length;
        }
      }
    }

    console.log(`   + Inserted ${total} walks`);
    return { count: total };
  }
}
