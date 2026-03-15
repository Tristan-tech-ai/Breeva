import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSeedData } from '../factories/userFactory';

export class SettingsSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const isDemoOrPower = userData.role === 'demo' || userData.tier === 'power';

      const { error } = await this.sb.from('user_settings').upsert(
        {
          user_id: userId,
          dark_mode: Math.random() > 0.7,
          push_notifications: true,
          location_tracking: true,
          quest_reminders: isDemoOrPower,
          anonymous_data: true,
          profile_visible: true,
          distance_unit: 'km',
          language: Math.random() > 0.3 ? 'id' : 'en',
        },
        { onConflict: 'user_id' },
      );

      if (error) {
        console.error(`   ✗ Settings for ${userData.email}: ${error.message}`);
      } else {
        total++;
      }
    }

    console.log(`   + Inserted ${total} user settings`);
    return { count: total };
  }
}
