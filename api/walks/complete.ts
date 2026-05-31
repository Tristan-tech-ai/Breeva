import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  // Fail loud at cold start: silently falling back to anon key would cause
  // every walk INSERT to be denied by RLS.
  console.error('[walks/complete] FATAL: missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface CompleteWalkRequest {
  walk_id: string;
  user_id: string;
  distance_meters: number;
  duration_seconds: number;
  avg_aqi?: number;
  transport_mode?: string;
  route_points?: Array<{ lat: number; lng: number; timestamp: string }>;
  started_at?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase service role' });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(
      process.env.VITE_SUPABASE_URL || '',
      process.env.VITE_SUPABASE_ANON_KEY || '',
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user: authUser }, error: authError } = await (userClient.auth as any).getUser();
    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const {
      walk_id,
      user_id,
      distance_meters,
      duration_seconds,
      avg_aqi,
      transport_mode,
      route_points,
      started_at,
    }: CompleteWalkRequest = req.body;

    if (!walk_id || !user_id || !distance_meters || !duration_seconds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify the user_id matches the authenticated user
    if (user_id !== authUser.id) {
      return res.status(403).json({ error: 'Forbidden: user mismatch' });
    }

    // Anti-cheat: Validate the walk
    const validationResult = validateWalk(distance_meters, duration_seconds, route_points);
    if (!validationResult.valid) {
      return res.status(400).json({ 
        error: 'Walk validation failed', 
        reason: validationResult.reason 
      });
    }

    const firstPoint = route_points?.[0];
    const lastPoint = route_points?.[route_points.length - 1];

    const { error: upsertError } = await supabase.from('walks').upsert({
      id: walk_id,
      user_id,
      origin_lat: firstPoint?.lat || 0,
      origin_lng: firstPoint?.lng || 0,
      destination_lat: lastPoint?.lat || 0,
      destination_lng: lastPoint?.lng || 0,
      route_polyline: JSON.stringify((route_points || []).map((p) => [p.lat, p.lng])),
      distance_meters,
      duration_seconds,
      route_type: 'eco',
      transport_mode: transport_mode || 'walking',
      status: 'active',
      started_at: started_at || new Date().toISOString(),
    }, { onConflict: 'id' });

    if (upsertError) {
      console.error('Walk upsert error:', upsertError);
      return res.status(500).json({ error: 'Failed to save walk data' });
    }

    // Update streak FIRST: update_user_streak reads users.last_walk_date,
    // and complete_walk sets last_walk_date = CURRENT_DATE. If we call streak
    // after complete_walk, the previous walk date is gone and the streak
    // function silently leaves current_streak unchanged.
    await supabase.rpc('update_user_streak', { p_user_id: user_id });

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

    // Advance today's quests from this walk's activity (mirrors checkAchievements)
    const quest_updates = await updateQuestProgress(user_id, {
      distance_meters,
      avg_aqi,
      started_at,
      transport_mode,
    });

    return res.status(200).json({
      success: true,
      ecopoints_earned: data[0]?.ecopoints_earned || 0,
      co2_saved: data[0]?.co2_saved || 0,
      new_achievements: achievements,
      quest_updates,
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

  // Minimum speed check (to prevent stationary "walks"). 0.1 m/s tolerates
  // stop-and-go walks (red lights, photo stops) which inflate duration; truly
  // stationary walks still trip this.
  if (avgSpeed < 0.1) {
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

  const unlockedSet = new Set(unlockedIds?.map((a: { achievement_id: string }) => a.achievement_id) || []);

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

// Translate a completed walk into quest-progress events. Server-authoritative:
// record_quest_progress is service_role-only, so progress can't be minted from
// the browser. Non-fatal — quest failures never block walk completion.
async function updateQuestProgress(
  userId: string,
  opts: { distance_meters: number; avg_aqi?: number; started_at?: string; transport_mode?: string }
): Promise<Array<{ title: string; reward: number }>> {
  try {
    await supabase.rpc('ensure_daily_quests', { p_user_id: userId });
  } catch { /* non-fatal */ }

  const events: Array<[string, number]> = [
    ['walk_distance_m', Math.round(opts.distance_meters)],
    ['walk_completed', 1],
  ];
  if (typeof opts.avg_aqi === 'number' && opts.avg_aqi <= 50) {
    events.push(['clean_air_walk', 1]);
  }
  if (opts.started_at) {
    // WIB (UTC+7): "morning" = started before 09:00 local
    const wibHour = (new Date(opts.started_at).getUTCHours() + 7) % 24;
    if (wibHour < 9) events.push(['morning_walk', 1]);
  }
  if (['walking', 'cycling', 'ebike'].includes(opts.transport_mode || 'walking')) {
    events.push(['eco_mode_walk', 1]);
  }

  const completed: Array<{ title: string; reward: number }> = [];
  for (const [eventType, value] of events) {
    try {
      const { data } = await supabase.rpc('record_quest_progress', {
        p_user_id: userId,
        p_event_type: eventType,
        p_value: value,
      });
      if (Array.isArray(data)) {
        for (const r of data as Array<{ completed?: boolean; title?: string; reward?: number }>) {
          if (r?.completed && r.title) completed.push({ title: r.title, reward: r.reward || 0 });
        }
      }
    } catch { /* non-fatal */ }
  }
  return completed;
}
