import { supabase } from './supabase';

export async function checkAndUnlockAchievements(userId: string): Promise<string[]> {
  // 1. Get user stats
  const { data: profile } = await supabase
    .from('users')
    .select('total_walks, total_distance_km, total_co2_saved_grams, longest_streak, ecopoints_balance')
    .eq('id', userId)
    .single();

  if (!profile) return [];

  // 2. Get all active achievements
  const { data: achievements } = await supabase
    .from('achievements')
    .select('id, name, requirement_type, requirement_value, points_reward')
    .eq('is_active', true);

  if (!achievements?.length) return [];

  // 3. Get already-unlocked
  const { data: unlocked } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId);

  const unlockedIds = new Set((unlocked || []).map((u) => u.achievement_id));

  // 4. Check each achievement
  const newUnlocks: string[] = [];

  for (const a of achievements) {
    if (unlockedIds.has(a.id)) continue;

    let met = false;
    switch (a.requirement_type) {
      case 'walks':
        met = (profile.total_walks || 0) >= a.requirement_value;
        break;
      case 'total_distance':
        // Achievement value is in meters, profile is in km
        met = (profile.total_distance_km || 0) * 1000 >= a.requirement_value;
        break;
      case 'streak':
        met = (profile.longest_streak || 0) >= a.requirement_value;
        break;
      case 'co2_saved':
        met = (profile.total_co2_saved_grams || 0) >= a.requirement_value;
        break;
      case 'total_points':
        met = (profile.ecopoints_balance || 0) >= a.requirement_value;
        break;
    }

    if (met) {
      // Server re-validates the requirement, inserts the unlock + grants the
      // achievement's defined points (can't be faked or over-granted client-side).
      const { data: granted } = await supabase.rpc('claim_achievement', {
        p_user_id: userId,
        p_achievement_id: a.id,
      });
      if (typeof granted === 'number' && granted > 0) {
        newUnlocks.push(a.name);
      }
    }
  }

  return newUnlocks;
}
