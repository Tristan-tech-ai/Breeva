// src/lib/metrics.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for Breeva's eco + XP/level metrics. Mirrors the DB
// EXACTLY so every page agrees:
//   • CO₂ is stored at 120 g/km by the complete_walk RPC. ALWAYS display from the
//     STORED grams (walks.co2_saved_grams / users.total_co2_saved_grams) via
//     co2KgFromGrams() — never recompute CO₂ from distance for display.
//   • XP/level/tier mirror _level_for_xp / _tier_for_level / get_level_progress
//     (supabase/migration_gam_0002).
// Replaces the scattered, divergent constants previously inlined in ProfilePage,
// YearInReviewPage, EcoImpactPage, WalkComplete and lib/utils.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────
/** Canonical CO₂ avoided vs driving — MUST match complete_walk (schema.sql). */
export const CO2_GRAMS_PER_KM = 120;
export const CALORIES_PER_KM = 60;
export const WATER_LITRES_PER_KM = 3.8;
export const TREE_KG_CO2_PER_YEAR = 22;
export const STEPS_PER_KM = 1312;
/** Brisk walking ~5 km/h → 12 min per km. */
export const ACTIVE_MIN_PER_KM = 12;
export const WEEKLY_GOAL_KM = 35;
export const POINTS_PER_KM = 10;

// ── CO₂ (the ONLY display path) ───────────────────────────────────────────────
/** Convert STORED grams → kilograms for display. Pass walks.co2_saved_grams or
 *  users.total_co2_saved_grams. This is the single CO₂ display path app-wide. */
export const co2KgFromGrams = (grams: number): number => Math.max(0, grams) / 1000;

/** COMPUTE-ONLY (not for display): grams that WOULD be saved over `km`. Use only
 *  in seed/reconcile tooling and share-card previews, never to render a stat. */
export const co2SavedGramsForKm = (km: number): number =>
  Math.round(Math.max(0, km) * CO2_GRAMS_PER_KM);

// ── Derived eco metrics (from kilometres) ─────────────────────────────────────
export const treesFromCo2Kg = (kg: number): number => Math.max(0, kg) / TREE_KG_CO2_PER_YEAR;
export const caloriesFromKm = (km: number): number => Math.round(Math.max(0, km) * CALORIES_PER_KM);
export const waterFromKm = (km: number): number => Math.max(0, km) * WATER_LITRES_PER_KM;
export const stepsFromKm = (km: number): number => Math.round(Math.max(0, km) * STEPS_PER_KM);
export const activeMinFromKm = (km: number): number => Math.round(Math.max(0, km) * ACTIVE_MIN_PER_KM);

export interface WeeklyGoal {
  goalKm: number;
  doneKm: number;
  pct: number;
  remainingKm: number;
}
export function weeklyGoalProgress(weekKm: number, goalKm = WEEKLY_GOAL_KM): WeeklyGoal {
  const done = Math.max(0, weekKm);
  return {
    goalKm,
    doneKm: done,
    pct: goalKm > 0 ? Math.min(100, (done / goalKm) * 100) : 0,
    remainingKm: Math.max(0, goalKm - done),
  };
}

// ── XP / Level / Tier (mirror migration_gam_0002) ─────────────────────────────
export type Tier = 'seed' | 'sprout' | 'sapling' | 'tree' | 'forest';
export const TIER_LABELS: Record<Tier, string> = {
  seed: 'Benih', sprout: 'Tunas', sapling: 'Semai', tree: 'Pohon', forest: 'Hutan',
};
export const TIER_EMOJI: Record<Tier, string> = {
  seed: '🌱', sprout: '🌿', sapling: '🪴', tree: '🌳', forest: '🌲',
};

/** _level_for_xp: GREATEST(1, floor(sqrt(max(xp,0)/50)) + 1). */
export const levelForXp = (xp: number): number =>
  Math.max(1, Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1);

/** _tier_for_level: thresholds at level 15 / 10 / 6 / 3. */
export function tierForLevel(level: number): Tier {
  if (level >= 15) return 'forest';
  if (level >= 10) return 'tree';
  if (level >= 6) return 'sapling';
  if (level >= 3) return 'sprout';
  return 'seed';
}

/** Cumulative XP at the START of a level: 50·(level−1)². */
export const xpAtLevelStart = (level: number): number => 50 * (level - 1) * (level - 1);
/** XP accumulated within the current level. */
export const xpIntoLevel = (xp: number, level: number): number =>
  Math.max(0, xp - xpAtLevelStart(level));
/** Total XP span of a level: 50·level² − 50·(level−1)². */
export const xpSpanForLevel = (level: number): number => 50 * level * level - xpAtLevelStart(level);
/** XP remaining to reach the next level. */
export const xpToNextLevel = (xp: number, level: number): number =>
  Math.max(0, xpAtLevelStart(level + 1) - xp);

export interface LevelProgress {
  level: number;
  tier: Tier;
  tierLabel: string;
  xp: number;
  into: number;
  span: number;
  pct: number;
  toNext: number;
}
/** Full level breakdown for an XP value. `level` optional (defaults to levelForXp). */
export function levelProgress(xp: number, level?: number): LevelProgress {
  const lvl = level ?? levelForXp(xp);
  const into = xpIntoLevel(xp, lvl);
  const span = xpSpanForLevel(lvl);
  const tier = tierForLevel(lvl);
  return {
    level: lvl,
    tier,
    tierLabel: TIER_LABELS[tier],
    xp,
    into,
    span,
    pct: span > 0 ? Math.min(100, (into / span) * 100) : 0,
    toNext: xpToNextLevel(xp, lvl),
  };
}
