-- ============================================================================
-- Migration 009 — Audit fixes (BREEVA_AUDIT_REPORT.md)
-- ============================================================================
--   • Issue 3 fix #1: short walks now award >=1 point instead of FLOOR(0) = 0
--   • Hidden #1: persist onboarding_completed server-side so device reinstall
--     doesn't force re-onboarding
--
-- HOW TO APPLY:
--   Open Supabase Dashboard → SQL Editor → New query → paste this file
--   and run it. It is idempotent (safe to re-run).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Add onboarding_completed column to users (Hidden Issue #1)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Backfill: any user that has earned points or completed walks is treated
-- as already onboarded so existing users don't see the onboarding flow again.
UPDATE users
SET onboarding_completed = TRUE
WHERE total_walks > 0 OR ecopoints_balance > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Rewrite complete_walk() — base points use ROUND with a 1-point floor
--    so sub-100m walks award 1 instead of 0. AQI bonus also uses ROUND.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_walk(
  p_walk_id UUID,
  p_distance_meters INTEGER,
  p_duration_seconds INTEGER,
  p_avg_aqi INTEGER DEFAULT NULL
) RETURNS TABLE(ecopoints_earned INTEGER, co2_saved INTEGER) AS $$
DECLARE
  v_user_id UUID;
  v_points INTEGER;
  v_co2 INTEGER;
  v_distance_km DECIMAL(10,2);
BEGIN
  SELECT user_id INTO v_user_id FROM walks WHERE id = p_walk_id;

  v_distance_km := p_distance_meters / 1000.0;
  -- Was: FLOOR(v_distance_km * 10) — any walk <100m awarded 0 points.
  -- Now: at least 1 point per recorded walk (the API anti-cheat already
  -- enforces a 50m minimum), rounded normally.
  v_points := GREATEST(1, ROUND(v_distance_km * 10)::INTEGER);

  IF p_avg_aqi IS NOT NULL AND p_avg_aqi <= 50 THEN
    v_points := v_points + ROUND(v_points * 0.5)::INTEGER;
  ELSIF p_avg_aqi IS NOT NULL AND p_avg_aqi <= 100 THEN
    v_points := v_points + ROUND(v_points * 0.25)::INTEGER;
  END IF;

  v_co2 := ROUND(v_distance_km * 120)::INTEGER;

  UPDATE walks SET
    distance_meters = p_distance_meters,
    duration_seconds = p_duration_seconds,
    avg_aqi = p_avg_aqi,
    ecopoints_earned = v_points,
    co2_saved_grams = v_co2,
    status = 'completed',
    completed_at = NOW(),
    is_verified = true
  WHERE id = p_walk_id;

  UPDATE users SET
    total_distance_km = total_distance_km + v_distance_km,
    total_walks = total_walks + 1,
    total_co2_saved_grams = total_co2_saved_grams + v_co2,
    last_walk_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE id = v_user_id;

  PERFORM add_ecopoints(v_user_id, v_points, 'walk', 'Points earned from walking', 'walk', p_walk_id);

  RETURN QUERY SELECT v_points, v_co2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Fix update_user_streak() ordering: walks/complete.ts now calls this
--    BEFORE complete_walk(), but the function previously had a subtle bug
--    where last_walk_date = CURRENT_DATE blocked both update branches. Add
--    an explicit "same day" branch that does nothing (re-walks on the same
--    day shouldn't change the streak) and clamp the lookup to handle nulls.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_user_streak(p_user_id UUID) RETURNS INTEGER AS $$
DECLARE
  v_last_walk DATE;
  v_current_streak INTEGER;
  v_longest_streak INTEGER;
BEGIN
  SELECT last_walk_date, current_streak, longest_streak
  INTO v_last_walk, v_current_streak, v_longest_streak
  FROM users WHERE id = p_user_id;

  IF v_last_walk = CURRENT_DATE THEN
    -- Already walked today; leave streak unchanged.
    RETURN COALESCE(v_current_streak, 0);
  ELSIF v_last_walk IS NULL OR v_last_walk < CURRENT_DATE - INTERVAL '1 day' THEN
    -- Gap of 2+ days (or first ever walk) — reset.
    v_current_streak := 1;
  ELSE
    -- v_last_walk = CURRENT_DATE - 1 (yesterday); continue streak.
    v_current_streak := COALESCE(v_current_streak, 0) + 1;
  END IF;

  IF v_current_streak > COALESCE(v_longest_streak, 0) THEN
    v_longest_streak := v_current_streak;
  END IF;

  UPDATE users SET
    current_streak = v_current_streak,
    longest_streak = v_longest_streak
  WHERE id = p_user_id;

  RETURN v_current_streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
