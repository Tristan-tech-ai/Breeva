-- set_0002: Honor Settings → Privacy → "Profile Visibility" in the leaderboards.
-- CREATE OR REPLACE the two gam_0008 functions, adding a user_settings join that
-- excludes profile_visible=false. COALESCE(...,true) keeps users with no settings row
-- visible (matches the column default). Per-user board keeps the caller's own rank
-- (self-exception). All other behaviour preserved verbatim.

CREATE OR REPLACE FUNCTION public.get_region_leaderboard(p_scope text, p_metric text DEFAULT 'points')
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, total_points integer,
              total_distance_meters integer, total_walks integer, rank integer, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_week date := public.breeva_active_leaderboard_week();
  v_my text; v_prov text; v_kab text;
BEGIN
  SELECT u.region_code INTO v_my FROM public.users u WHERE u.id = v_uid;
  v_prov := split_part(v_my, '.', 1);
  v_kab  := split_part(v_my, '.', 1) || '.' || split_part(v_my, '.', 2);
  RETURN QUERY
  WITH pool AS (
    SELECT u.id, u.full_name, u.avatar_url, u.region_code AS rc,
           lw.total_points_earned AS pts, lw.total_distance_meters AS dist, lw.total_walks AS wlk
    FROM public.leaderboard_weekly lw
    JOIN public.users u ON u.id = lw.user_id
    LEFT JOIN public.user_settings us ON us.user_id = u.id
    WHERE lw.week_start = v_week
      AND (COALESCE(us.profile_visible, true) OR u.id = v_uid)
      AND (
        p_scope = 'nasional'
        OR (v_my IS NOT NULL AND p_scope = 'provinsi'  AND split_part(u.region_code, '.', 1) = v_prov)
        OR (v_my IS NOT NULL AND p_scope = 'kabupaten' AND split_part(u.region_code, '.', 1) || '.' || split_part(u.region_code, '.', 2) = v_kab)
        OR (v_my IS NOT NULL AND p_scope = 'desa'      AND u.region_code = v_my)
      )
  ),
  ranked AS (
    SELECT p.*, RANK() OVER (
      ORDER BY CASE WHEN p_metric = 'distance' THEN p.dist ELSE p.pts END DESC,
               CASE WHEN p_metric = 'distance' THEN p.pts ELSE p.dist END DESC
    ) AS rnk
    FROM pool p
  )
  SELECT r.id, COALESCE(r.full_name, 'Green Walker')::text, r.avatar_url::text, r.pts, r.dist, r.wlk, r.rnk::int, (r.id = v_uid)
  FROM ranked r ORDER BY r.rnk LIMIT 100;
END; $fn$;

REVOKE ALL ON FUNCTION public.get_region_leaderboard(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_region_leaderboard(text, text) TO authenticated;

-- Region-vs-region rollup (feeds get_region_standings): hidden users contribute neither
-- name nor points to a region's public standing.
CREATE OR REPLACE FUNCTION public.refresh_region_leaderboard()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_week date := public.breeva_active_leaderboard_week();
  v_count int := 0;
BEGIN
  IF v_week IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.region_leaderboard_weekly;
  WITH base AS (
    SELECT u.region_code AS desa,
           split_part(u.region_code, '.', 1) AS prov,
           split_part(u.region_code, '.', 1) || '.' || split_part(u.region_code, '.', 2) AS kab,
           lw.total_points_earned AS pts, lw.total_distance_meters AS dist, lw.total_walks AS walks
    FROM public.leaderboard_weekly lw
    JOIN public.users u ON u.id = lw.user_id
    LEFT JOIN public.user_settings us ON us.user_id = u.id
    WHERE lw.week_start = v_week AND u.region_code IS NOT NULL
      AND COALESCE(us.profile_visible, true)
  ),
  agg AS (
    SELECT 4::smallint AS level, desa AS code, sum(pts)::int pts, sum(dist)::int dist, sum(walks)::int walks, count(*)::int members FROM base GROUP BY desa
    UNION ALL
    SELECT 2::smallint, kab, sum(pts)::int, sum(dist)::int, sum(walks)::int, count(*)::int FROM base GROUP BY kab
    UNION ALL
    SELECT 1::smallint, prov, sum(pts)::int, sum(dist)::int, sum(walks)::int, count(*)::int FROM base GROUP BY prov
  ),
  ranked AS (
    SELECT level, code, pts, dist, walks, members,
           RANK() OVER (PARTITION BY level ORDER BY pts DESC, dist DESC) AS rnk
    FROM agg
  )
  INSERT INTO public.region_leaderboard_weekly
    (region_code, level, week_start, total_points, total_distance_meters, total_walks, member_count, rank, updated_at)
  SELECT code, level, v_week, pts, dist, walks, members, rnk, now() FROM ranked;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $fn$;

REVOKE ALL ON FUNCTION public.refresh_region_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_region_leaderboard() TO service_role;
