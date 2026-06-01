-- gam_0011: Reconcile users.total_* with the actual `walks` rows + integrity helpers.
-- Applied 2026-06-01.
--
-- Background: seeded users.total_walks / total_distance_km / total_co2_saved_grams were
-- written independently of the walk rows, so Profile/EcoImpact (read users.total_*)
-- disagreed with WalkHistory (reads walks). This makes the WALKS table authoritative.
-- CO₂ canonical = 120 g/km (matches complete_walk + src/lib/metrics.ts); walks already
-- store co2_saved_grams = round(distance_meters * 0.12), so no CO₂ data change is needed —
-- we only re-derive the per-user rollups.

-- 1. One-shot backfill (covers every user; zeroes those with no completed walks).
UPDATE public.users u SET
  total_walks           = COALESCE(a.n, 0),
  total_distance_km     = COALESCE(a.km, 0),
  total_co2_saved_grams = COALESCE(a.co2, 0),
  last_walk_date        = a.last_date,
  updated_at            = now()
FROM public.users u2
LEFT JOIN (
  SELECT user_id,
         COUNT(*)                                   AS n,
         ROUND((SUM(distance_meters) / 1000.0)::numeric, 2) AS km,
         COALESCE(SUM(co2_saved_grams), 0)::int     AS co2,
         MAX(completed_at)::date                    AS last_date
  FROM public.walks
  WHERE status = 'completed'
  GROUP BY user_id
) a ON a.user_id = u2.id
WHERE u.id = u2.id;

-- 2. Reusable single-user recompute (for the seeder + reconcile script + future jobs).
CREATE OR REPLACE FUNCTION public.recompute_user_stats(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.users u SET
    total_walks           = COALESCE(a.n, 0),
    total_distance_km     = COALESCE(a.km, 0),
    total_co2_saved_grams = COALESCE(a.co2, 0),
    last_walk_date        = a.last_date,
    updated_at            = now()
  FROM (
    SELECT COUNT(*) FILTER (WHERE status = 'completed')                                   AS n,
           ROUND((SUM(distance_meters) FILTER (WHERE status = 'completed') / 1000.0)::numeric, 2) AS km,
           COALESCE(SUM(co2_saved_grams) FILTER (WHERE status = 'completed'), 0)::int     AS co2,
           MAX(completed_at) FILTER (WHERE status = 'completed')::date                    AS last_date
    FROM public.walks WHERE user_id = p_user_id
  ) a
  WHERE u.id = p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.recompute_user_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_stats(uuid) TO service_role;

-- 3. Admin integrity view: drift between stored rollups and authoritative sources.
CREATE OR REPLACE VIEW public.v_user_stat_integrity AS
SELECT
  u.id AS user_id, u.email,
  u.ecopoints_balance AS balance,
  COALESCE((SELECT SUM(amount) FROM public.points_transactions pt WHERE pt.user_id = u.id), 0) AS ledger_sum,
  u.ecopoints_balance - COALESCE((SELECT SUM(amount) FROM public.points_transactions pt WHERE pt.user_id = u.id), 0) AS balance_drift,
  u.total_walks AS stored_walks,
  COALESCE((SELECT COUNT(*) FROM public.walks w WHERE w.user_id = u.id AND w.status = 'completed'), 0) AS walk_rows,
  u.total_walks - COALESCE((SELECT COUNT(*) FROM public.walks w WHERE w.user_id = u.id AND w.status = 'completed'), 0) AS walk_drift,
  u.total_co2_saved_grams AS stored_co2,
  COALESCE((SELECT SUM(co2_saved_grams) FROM public.walks w WHERE w.user_id = u.id AND w.status = 'completed'), 0) AS walk_co2,
  u.total_co2_saved_grams - COALESCE((SELECT SUM(co2_saved_grams) FROM public.walks w WHERE w.user_id = u.id AND w.status = 'completed'), 0) AS co2_drift
FROM public.users u;
REVOKE ALL ON public.v_user_stat_integrity FROM anon, authenticated;
GRANT SELECT ON public.v_user_stat_integrity TO service_role;
