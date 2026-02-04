import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '' // Use service role for server-side operations
);

interface CompleteWalkRequest {
  walk_id: string;
  user_id: string;
  distance_meters: number;
  duration_seconds: number;
  avg_aqi?: number;
  route_points?: Array<{ lat: number; lng: number; timestamp: string }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      walk_id,
      user_id,
      distance_meters,
      duration_seconds,
      avg_aqi,
      route_points,
    }: CompleteWalkRequest = req.body;

    if (!walk_id || !user_id || !distance_meters || !duration_seconds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Anti-cheat: Validate the walk
    const validationResult = validateWalk(distance_meters, duration_seconds, route_points);
    if (!validationResult.valid) {
      return res.status(400).json({ 
        error: 'Walk validation failed', 
        reason: validationResult.reason 
      });
    }

    // Call Supabase function to complete walk and award points
    const { data, error } = await supabase.rpc('complete_walk', {
      p_walk_id: walk_id,
      p_distance_meters: distance_meters,
      p_duration_seconds: duration_seconds,
      p_avg_aqi: avg_aqi || null,
    });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to complete walk' });
    }

    // Check for new achievements
    const achievements = await checkAchievements(user_id);

    return res.status(200).json({
      success: true,
      ecopoints_earned: data[0]?.ecopoints_earned || 0,
      co2_saved: data[0]?.co2_saved || 0,
      new_achievements: achievements,
    });
  } catch (error) {
    console.error('Complete walk error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateWalk(
  distanceMeters: number,
  durationSeconds: number,
  routePoints?: Array<{ lat: number; lng: number; timestamp: string }>
): ValidationResult {
  // Basic validation
  if (distanceMeters <= 0 || durationSeconds <= 0) {
    return { valid: false, reason: 'Invalid distance or duration' };
  }

  // Speed check: Average walking speed is 1.4 m/s (5 km/h)
  // Max reasonable speed is about 3 m/s (10.8 km/h) for fast walking
  const avgSpeed = distanceMeters / durationSeconds;
  if (avgSpeed > 3) {
    return { valid: false, reason: 'Speed too high for walking' };
  }

  // Minimum speed check (to prevent stationary "walks")
  if (avgSpeed < 0.3) {
    return { valid: false, reason: 'Speed too low' };
  }

  // If route points provided, validate they're realistic
  if (routePoints && routePoints.length > 1) {
    // Check for teleportation (sudden large jumps)
    for (let i = 1; i < routePoints.length; i++) {
      const prev = routePoints[i - 1];
      const curr = routePoints[i];
      
      const timeDiff = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
      const distance = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
      
      if (timeDiff > 0) {
        const segmentSpeed = distance / timeDiff;
        if (segmentSpeed > 10) { // More than 36 km/h is definitely not walking
          return { valid: false, reason: 'Suspicious movement detected' };
        }
      }
    }
  }

  return { valid: true };
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function checkAchievements(userId: string): Promise<string[]> {
  // Get user stats
  const { data: user } = await supabase
    .from('users')
    .select('total_walks, total_distance_km, current_streak, total_co2_saved_grams, ecopoints_balance')
    .eq('id', userId)
    .single();

  if (!user) return [];

  // Get achievements user doesn't have yet
  const { data: unlockedIds } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId);

  const unlockedSet = new Set(unlockedIds?.map(a => a.achievement_id) || []);

  const { data: allAchievements } = await supabase
    .from('achievements')
    .select('*')
    .eq('is_active', true);

  if (!allAchievements) return [];

  const newAchievements: string[] = [];

  for (const achievement of allAchievements) {
    if (unlockedSet.has(achievement.id)) continue;

    let qualified = false;

    switch (achievement.requirement_type) {
      case 'walks':
        qualified = user.total_walks >= achievement.requirement_value;
        break;
      case 'total_distance':
        qualified = (user.total_distance_km * 1000) >= achievement.requirement_value;
        break;
      case 'streak':
        qualified = user.current_streak >= achievement.requirement_value;
        break;
      case 'co2_saved':
        qualified = user.total_co2_saved_grams >= achievement.requirement_value;
        break;
      case 'total_points':
        qualified = user.ecopoints_balance >= achievement.requirement_value;
        break;
    }

    if (qualified) {
      // Unlock achievement
      await supabase.from('user_achievements').insert({
        user_id: userId,
        achievement_id: achievement.id,
      });

      // Award bonus points
      if (achievement.points_reward > 0) {
        await supabase.rpc('add_ecopoints', {
          p_user_id: userId,
          p_amount: achievement.points_reward,
          p_type: 'achievement',
          p_description: `Achievement unlocked: ${achievement.name}`,
          p_reference_type: 'achievement',
          p_reference_id: achievement.id,
        });
      }

      newAchievements.push(achievement.name);
    }
  }

  return newAchievements;
}
