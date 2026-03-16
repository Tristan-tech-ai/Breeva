import { randomBetween } from '../utils/helpers';
import type { UserSeedData } from './userFactory';

export interface LeaderboardWeeklyRow {
  user_id: string;
  week_start: string;
  total_distance_meters: number;
  total_walks: number;
  total_points_earned: number;
}

/** Tier-based weekly stat ranges */
const WEEKLY_STATS: Record<string, { walks: [number, number]; distKm: [number, number]; pts: [number, number] }> = {
  power:   { walks: [5, 10], distKm: [8, 25],  pts: [80, 200] },
  active:  { walks: [3, 7],  distKm: [4, 15],  pts: [40, 120] },
  casual:  { walks: [1, 3],  distKm: [1, 6],   pts: [10, 50]  },
  new:     { walks: [0, 2],  distKm: [0, 3],   pts: [0, 30]   },
  dormant: { walks: [0, 1],  distKm: [0, 2],   pts: [0, 15]   },
};

/** Get the Monday (ISO week start) for a given date */
function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split('T')[0];
}

/**
 * Generate leaderboard_weekly rows for a user over the past N weeks.
 * Dormant users get fewer weeks of activity.
 */
export function makeLeaderboardForUser(
  userId: string,
  userData: UserSeedData,
  weeksBack: number,
): LeaderboardWeeklyRow[] {
  const stats = WEEKLY_STATS[userData.tier] ?? WEEKLY_STATS.casual;
  const rows: LeaderboardWeeklyRow[] = [];

  for (let w = 0; w < weeksBack; w++) {
    // Dormant users skip recent weeks; new users skip older weeks
    if (userData.tier === 'dormant' && w < 2) continue;
    if (userData.tier === 'new' && w > 3) continue;

    // Random chance to skip a week (more likely for casual/dormant)
    const skipChance = userData.tier === 'power' ? 0.05 : userData.tier === 'active' ? 0.15 : 0.35;
    if (Math.random() < skipChance) continue;

    const walks = randomBetween(stats.walks[0], stats.walks[1]);
    if (walks === 0 && Math.random() > 0.3) continue; // skip zeroes most of the time

    const distKm = walks === 0 ? 0 : randomBetween(stats.distKm[0] * 10, stats.distKm[1] * 10) / 10;
    const pts = walks === 0 ? 0 : randomBetween(stats.pts[0], stats.pts[1]);

    const weekDate = new Date();
    weekDate.setDate(weekDate.getDate() - w * 7);

    rows.push({
      user_id: userId,
      week_start: getWeekStart(weekDate),
      total_distance_meters: Math.round(distKm * 1000),
      total_walks: walks,
      total_points_earned: pts,
    });
  }

  return rows;
}
