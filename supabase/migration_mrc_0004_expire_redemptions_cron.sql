-- mrc_0004: Auto-expire stale active vouchers (no cron existed → expired ones lingered 'active').
CREATE OR REPLACE FUNCTION public.expire_redemptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE public.redeemed_rewards SET status = 'expired'
   WHERE status = 'active' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $fn$;

REVOKE ALL ON FUNCTION public.expire_redemptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_redemptions() TO service_role;

-- Hourly (idempotent: drop any existing job with this name first).
DO $$ BEGIN
  PERFORM cron.unschedule('breeva-expire-redemptions');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('breeva-expire-redemptions', '7 * * * *', $$SELECT public.expire_redemptions();$$);
