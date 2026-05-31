-- gam_0005: Real weekly leaderboard — aggregate this WIB-week's completed walks
-- + earned points into leaderboard_weekly with live ranks (kept as a table to
-- preserve the Realtime publication from migration 0013). Applied 2026-05-31.
CREATE OR REPLACE FUNCTION public.refresh_weekly_leaderboard()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'Asia/Jakarta'))::date;
  v_week_ts timestamptz := (v_week_start::timestamp AT TIME ZONE 'Asia/Jakarta');
  v_count int;
BEGIN
  WITH wk AS (
    SELECT u.id AS user_id,
           COALESCE(w.dist, 0) AS dist, COALESCE(w.cnt, 0) AS cnt, COALESCE(p.pts, 0) AS pts
    FROM public.users u
    LEFT JOIN (
      SELECT user_id, SUM(distance_meters)::int AS dist, COUNT(*)::int AS cnt
      FROM public.walks WHERE status = 'completed' AND completed_at >= v_week_ts
      GROUP BY user_id
    ) w ON w.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(amount)::int AS pts
      FROM public.points_transactions WHERE amount > 0 AND created_at >= v_week_ts
      GROUP BY user_id
    ) p ON p.user_id = u.id
  ),
  ranked AS (
    SELECT user_id, dist, cnt, pts, RANK() OVER (ORDER BY pts DESC, dist DESC) AS rnk
    FROM wk WHERE pts > 0 OR cnt > 0
  )
  INSERT INTO public.leaderboard_weekly
    (user_id, week_start, total_distance_meters, total_walks, total_points_earned, rank, updated_at)
  SELECT user_id, v_week_start, dist, cnt, pts, rnk, now() FROM ranked
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    total_distance_meters = EXCLUDED.total_distance_meters,
    total_walks = EXCLUDED.total_walks,
    total_points_earned = EXCLUDED.total_points_earned,
    rank = EXCLUDED.rank,
    updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.refresh_weekly_leaderboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_weekly_leaderboard() TO service_role;

SELECT cron.schedule('breeva-leaderboard-refresh', '*/15 * * * *', $$SELECT public.refresh_weekly_leaderboard()$$);
SELECT public.refresh_weekly_leaderboard();
