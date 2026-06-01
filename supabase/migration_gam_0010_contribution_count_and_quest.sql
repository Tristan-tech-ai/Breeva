-- gam_0010: users.contribution_count (+ backfill), an atomic increment RPC the
-- contribution endpoint calls after a successful insert, and a 'place_report' quest
-- template so POI suggestions advance a quest (AQI reports already use 'aqi_report').
-- Depends on gam_0009 (place_contributions must exist for the backfill).

-- 1. contribution_count + backfill (source='report' only, matching the endpoint's
--    increment rule: calibration walk-ratings do NOT count as contributions).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS contribution_count integer NOT NULL DEFAULT 0;

UPDATE public.users u SET contribution_count =
    COALESCE((SELECT count(*) FROM public.air_quality_reports a
              WHERE a.user_id = u.id AND a.source = 'report'), 0)
  + COALESCE((SELECT count(*) FROM public.place_contributions p
              WHERE p.user_id = u.id), 0);

-- 2. Atomic, service-role-only increment (endpoint calls this once per successful insert).
CREATE OR REPLACE FUNCTION public.increment_contribution_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  UPDATE public.users
     SET contribution_count = contribution_count + 1, updated_at = now()
   WHERE id = p_user_id
  RETURNING contribution_count;
$fn$;
REVOKE ALL ON FUNCTION public.increment_contribution_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_contribution_count(uuid) TO service_role;

-- 3. 'place_report' adaptive quest template (POI contributions). Same shape as the
--    seeded 'aqi_report' template; reward a touch lower.
INSERT INTO public.quest_templates
  (code, title_template, description_template, icon, quest_type, event_type, unit,
   base_target, target_per_level, target_min, target_max, base_reward, reward_per_level, min_level, weight)
VALUES
  ('place_report','Lengkapi peta','Tambahkan {t} tempat baru ke peta.','map-pin-plus','report','place_report','count',1,0.1,1,3,12,2,1,2)
ON CONFLICT (code) DO NOTHING;
