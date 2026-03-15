import { randomBetween, randomDate, randomDateStr } from '../utils/helpers';
import { INDONESIAN_NAMES, type NameEntry } from '../data/indonesian-names';

export interface UserSeedData {
  email: string;
  password: string;
  full_name: string;
  avatar_url: string;
  // Stats to apply after auth creation
  ecopoints_balance: number;
  total_ecopoints_earned: number;
  total_distance_km: number;
  total_walks: number;
  total_co2_saved_grams: number;
  current_streak: number;
  longest_streak: number;
  last_walk_date: string | null;
  subscription_tier: string;
  city: string;
}

function buildUser(entry: NameEntry): UserSeedData {
  const tiers: Record<string, () => UserSeedData> = {
    power: () => {
      const walks = randomBetween(60, 100);
      const distKm = parseFloat((walks * randomBetween(15, 40) / 10).toFixed(2));
      const co2 = Math.round(distKm * 1000 * 0.12);
      const totalPts = walks * randomBetween(10, 15);
      const spent = randomBetween(0, Math.floor(totalPts * 0.3));
      const streak = randomBetween(15, 30);
      return {
        email: `${entry.first.toLowerCase()}.${entry.last.toLowerCase()}@example.com`,
        password: 'Breeva2026!seed',
        full_name: `${entry.first} ${entry.last}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.first}`,
        ecopoints_balance: totalPts - spent,
        total_ecopoints_earned: totalPts,
        total_distance_km: distKm,
        total_walks: walks,
        total_co2_saved_grams: co2,
        current_streak: streak,
        longest_streak: Math.max(streak, randomBetween(streak, streak + 5)),
        last_walk_date: randomDateStr(-2, 0),
        subscription_tier: Math.random() > 0.5 ? 'premium' : 'free',
        city: entry.city,
      };
    },
    active: () => {
      const walks = randomBetween(20, 50);
      const distKm = parseFloat((walks * randomBetween(10, 30) / 10).toFixed(2));
      const co2 = Math.round(distKm * 1000 * 0.12);
      const totalPts = walks * randomBetween(8, 14);
      const spent = randomBetween(0, Math.floor(totalPts * 0.2));
      const streak = randomBetween(5, 14);
      return {
        email: `${entry.first.toLowerCase()}.${entry.last.toLowerCase()}@example.com`,
        password: 'Breeva2026!seed',
        full_name: `${entry.first} ${entry.last}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.first}`,
        ecopoints_balance: totalPts - spent,
        total_ecopoints_earned: totalPts,
        total_distance_km: distKm,
        total_walks: walks,
        total_co2_saved_grams: co2,
        current_streak: streak,
        longest_streak: Math.max(streak, randomBetween(streak, streak + 7)),
        last_walk_date: randomDateStr(-3, 0),
        subscription_tier: 'free',
        city: entry.city,
      };
    },
    casual: () => {
      const walks = randomBetween(5, 19);
      const distKm = parseFloat((walks * randomBetween(8, 20) / 10).toFixed(2));
      const co2 = Math.round(distKm * 1000 * 0.12);
      const totalPts = walks * randomBetween(8, 12);
      const streak = randomBetween(1, 4);
      return {
        email: `${entry.first.toLowerCase()}.${entry.last.toLowerCase()}@example.com`,
        password: 'Breeva2026!seed',
        full_name: `${entry.first} ${entry.last}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.first}`,
        ecopoints_balance: totalPts,
        total_ecopoints_earned: totalPts,
        total_distance_km: distKm,
        total_walks: walks,
        total_co2_saved_grams: co2,
        current_streak: streak,
        longest_streak: randomBetween(streak, streak + 3),
        last_walk_date: randomDateStr(-7, 0),
        subscription_tier: 'free',
        city: entry.city,
      };
    },
    new: () => ({
      email: `${entry.first.toLowerCase()}.${entry.last.toLowerCase()}@example.com`,
      password: 'Breeva2026!seed',
      full_name: `${entry.first} ${entry.last}`,
      avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.first}`,
      ecopoints_balance: 100,
      total_ecopoints_earned: 100,
      total_distance_km: randomBetween(0, 3),
      total_walks: randomBetween(0, 2),
      total_co2_saved_grams: randomBetween(0, 400),
      current_streak: randomBetween(0, 1),
      longest_streak: randomBetween(0, 1),
      last_walk_date: randomBetween(0, 1) ? randomDateStr(-1, 0) : null,
      subscription_tier: 'free',
      city: entry.city,
    }),
    dormant: () => {
      const walks = randomBetween(5, 10);
      const distKm = parseFloat((walks * randomBetween(10, 25) / 10).toFixed(2));
      const co2 = Math.round(distKm * 1000 * 0.12);
      const totalPts = walks * randomBetween(8, 12);
      return {
        email: `${entry.first.toLowerCase()}.${entry.last.toLowerCase()}@example.com`,
        password: 'Breeva2026!seed',
        full_name: `${entry.first} ${entry.last}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.first}`,
        ecopoints_balance: totalPts,
        total_ecopoints_earned: totalPts,
        total_distance_km: distKm,
        total_walks: walks,
        total_co2_saved_grams: co2,
        current_streak: 0,
        longest_streak: randomBetween(3, 8),
        last_walk_date: randomDateStr(-30, -7),
        subscription_tier: 'free',
        city: entry.city,
      };
    },
  };

  return tiers[entry.tier]();
}

export function makeAllUsers(): UserSeedData[] {
  return INDONESIAN_NAMES.map(buildUser);
}
