-- gam_0004: Pre-warm the new WIB day's quests for recently-active users at
-- 00:00 WIB. Correctness is already covered by on-demand ensure_daily_quests
-- (page load + walk); this just makes quests ready at midnight. Applied 2026-05-31.
CREATE OR REPLACE FUNCTION public.reset_daily_quests()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user record; v_count int := 0;
BEGIN
  FOR v_user IN
    SELECT id FROM public.users
    WHERE last_walk_date >= ((now() AT TIME ZONE 'Asia/Jakarta')::date - INTERVAL '14 days')
  LOOP
    PERFORM public.ensure_daily_quests(v_user.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.reset_daily_quests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_daily_quests() TO service_role;

-- 00:00 WIB = 17:00 UTC. cron.schedule upserts by job name (idempotent).
SELECT cron.schedule('breeva-quest-reset-wib', '0 17 * * *', $$SELECT public.reset_daily_quests()$$);
