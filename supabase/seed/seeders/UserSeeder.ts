import type { SupabaseClient } from '@supabase/supabase-js';
import { makeAllUsers, type UserSeedData } from '../factories/userFactory';

/**
 * Create users via Supabase Auth Admin API, then update their profile stats.
 * The `handle_new_user()` trigger auto-creates the public.users row.
 */
export class UserSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(): Promise<{ count: number; userMap: Map<string, UserSeedData> }> {
    const users = makeAllUsers();
    const userMap = new Map<string, UserSeedData>();

    for (const u of users) {
      // Check if this email already exists in auth
      const { data: existing } = await this.sb.auth.admin.listUsers();
      const found = existing?.users?.find((eu) => eu.email === u.email);

      let userId: string;

      if (found) {
        userId = found.id;
        console.log(`   ↩ User ${u.email} already exists (${userId})`);
      } else {
        const { data: authUser, error: authErr } =
          await this.sb.auth.admin.createUser({
            email: u.email,
            password: u.password,
            email_confirm: true,
            user_metadata: {
              full_name: u.full_name,
              avatar_url: u.avatar_url,
            },
          });

        if (authErr || !authUser.user) {
          console.error(`   ✗ Failed to create ${u.email}: ${authErr?.message}`);
          continue;
        }
        userId = authUser.user.id;
        console.log(`   + Created auth user ${u.email} (${userId})`);
      }

      // Update public.users stats (profile row created by trigger)
      // Small delay to let the trigger fire
      await new Promise((r) => setTimeout(r, 200));

      const { error: updateErr } = await this.sb
        .from('users')
        .update({
          ecopoints_balance: u.ecopoints_balance,
          total_distance_km: u.total_distance_km,
          total_walks: u.total_walks,
          total_co2_saved_grams: u.total_co2_saved_grams,
          current_streak: u.current_streak,
          longest_streak: u.longest_streak,
          last_walk_date: u.last_walk_date,
          subscription_tier: u.subscription_tier,
        })
        .eq('id', userId);

      if (updateErr) {
        console.error(`   ✗ Failed to update stats for ${u.email}: ${updateErr.message}`);
      }

      userMap.set(userId, u);
    }

    return { count: userMap.size, userMap };
  }
}
