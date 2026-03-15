import type { SupabaseClient } from '@supabase/supabase-js';
import { makeWalksForUser } from '../factories/walkFactory';
import { randomBetween } from '../utils/helpers';
import type { UserSeedData } from '../factories/userFactory';
import type { City } from '../data/city-locations';

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
      const walks = makeWalksForUser(userId, userData.city as City, count, daysBack);

      // Batch insert in chunks of 25
      for (let i = 0; i < walks.length; i += 25) {
        const chunk = walks.slice(i, i + 25);
        const { error } = await this.sb.from('walks').insert(
          chunk.map((w) => ({
            user_id: w.user_id,
            started_at: w.started_at,
            completed_at: w.completed_at,
            duration_seconds: w.duration_seconds,
            distance_meters: w.distance_meters,
            origin_address: w.origin_address,
            origin_lat: w.origin_lat,
            origin_lng: w.origin_lng,
            destination_address: w.destination_address,
            destination_lat: w.destination_lat,
            destination_lng: w.destination_lng,
            avg_aqi: w.avg_aqi,
            ecopoints_earned: w.ecopoints_earned,
            co2_saved_grams: w.co2_saved_grams,
            route_type: w.route_type,
            status: w.status,
            is_verified: w.is_verified,
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
