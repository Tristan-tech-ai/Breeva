-- gam_0012: get_achievement_progress — read-only "how close to each badge" RPC.
-- Applied 2026-06-01. Powers the redesigned Achievements grid + NextBadgeCard.
--
-- Requirement mapping mirrors claim_achievement (migration_gam_0006) EXACTLY so the
-- progress shown agrees with what actually unlocks:
--   walks          → users.total_walks
--   total_distance → users.total_distance_km * 1000  (requirement_value is in metres)
--   streak         → GREATEST(longest_streak, current_streak)
--   co2_saved      → users.total_co2_saved_grams      (requirement_value is in grams)
--   total_points   → users.ecopoints_balance
-- Pure read — never mints points, so it is safe to expose to authenticated.

CREATE OR REPLACE FUNCTION public.get_achievement_progress(p_user_id uuid)
RETURNS TABLE(
  achievement_id uuid, name text, description text, icon text, category text,
  requirement_type text, requirement_value integer, points_reward integer,
  is_unlocked boolean, unlocked_at timestamptz,
  current_value bigint, remaining bigint, progress_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_walks int; v_dist_m bigint; v_streak int; v_co2 bigint; v_points int;
BEGIN
  SELECT u.total_walks,
         ROUND(u.total_distance_km * 1000)::bigint,
         GREATEST(COALESCE(u.longest_streak, 0), COALESCE(u.current_streak, 0)),
         u.total_co2_saved_grams,
         u.ecopoints_balance
    INTO v_walks, v_dist_m, v_streak, v_co2, v_points
  FROM public.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id, a.name::text, a.description::text, a.icon::text, a.category::text,
    a.requirement_type::text, a.requirement_value, a.points_reward,
    (ua.achievement_id IS NOT NULL) AS is_unlocked,
    ua.unlocked_at,
    cur.val AS current_value,
    GREATEST(0, a.requirement_value - cur.val) AS remaining,
    LEAST(100, ROUND(cur.val::numeric / NULLIF(a.requirement_value, 0) * 100, 1)) AS progress_pct
  FROM public.achievements a
  LEFT JOIN public.user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = p_user_id
  CROSS JOIN LATERAL (
    SELECT (CASE a.requirement_type
              WHEN 'walks'          THEN v_walks
              WHEN 'total_distance' THEN v_dist_m
              WHEN 'streak'         THEN v_streak
              WHEN 'co2_saved'      THEN v_co2
              WHEN 'total_points'   THEN v_points
              ELSE 0 END)::bigint AS val
  ) cur
  WHERE a.is_active = true
  ORDER BY a.requirement_value;
END; $$;

REVOKE ALL ON FUNCTION public.get_achievement_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_achievement_progress(uuid) TO authenticated, service_role;
