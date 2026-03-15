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
      // Insert into user_achievements
      const { error } = await supabase
        .from('user_achievements')
        .insert({ user_id: userId, achievement_id: a.id });

      if (!error) {
        newUnlocks.push(a.name);

        // Award points reward
        if (a.points_reward > 0) {
          await supabase.rpc('add_ecopoints', {
            p_user_id: userId,
            p_amount: a.points_reward,
            p_type: 'achievement',
            p_description: `Achievement unlocked: ${a.name}`,
            p_reference_id: a.id,
          });
        }
      }
    }
  }

  return newUnlocks;
}
