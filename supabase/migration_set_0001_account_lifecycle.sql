-- set_0001: Account lifecycle + the one missing settings column.
-- Self-service data/account deletion (RPCs, no new serverless fn — Vercel 12-fn cap),
-- 30-day grace before hard-delete (cron). Additive/idempotent.

-- 1. Schema
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled
  ON public.users (deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS high_contrast boolean NOT NULL DEFAULT false;

-- 2. Schedule deletion (30-day grace). Reauth/OTP enforced client-side; only ever the caller's row.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_when timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_when := now() + interval '30 days';
  UPDATE public.users SET deletion_scheduled_at = v_when, updated_at = now() WHERE id = v_uid;
  RETURN v_when;
END; $fn$;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

-- 3. Cancel a scheduled deletion (called on next sign-in, or from the grace banner).
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  UPDATE public.users SET deletion_scheduled_at = NULL, updated_at = now() WHERE id = v_uid;
  RETURN true;
END; $fn$;
REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

-- 4. Delete app data but KEEP the account (simpler path). Idempotent.
CREATE OR REPLACE FUNCTION public.delete_my_data()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.merchants SET owner_id = NULL WHERE owner_id = v_uid;  -- NO-ACTION FK → relinquish first
  DELETE FROM public.walks               WHERE user_id = v_uid;
  DELETE FROM public.points_transactions WHERE user_id = v_uid;
  DELETE FROM public.redeemed_rewards    WHERE user_id = v_uid;
  DELETE FROM public.reviews             WHERE user_id = v_uid;
  DELETE FROM public.review_flags        WHERE user_id = v_uid;
  DELETE FROM public.user_achievements   WHERE user_id = v_uid;
  DELETE FROM public.user_quests         WHERE user_id = v_uid;
  DELETE FROM public.saved_places        WHERE user_id = v_uid;
  DELETE FROM public.place_contributions WHERE user_id = v_uid;
  DELETE FROM public.air_quality_reports WHERE user_id = v_uid;
  DELETE FROM public.exposure_ledger     WHERE user_id = v_uid;
  DELETE FROM public.leaderboard_weekly  WHERE user_id = v_uid;
  UPDATE public.users SET
    ecopoints_balance = 0, total_distance_km = 0, total_walks = 0, total_co2_saved_grams = 0,
    current_streak = 0, longest_streak = 0, last_walk_date = NULL,
    xp = 0, level = 1, tier = 'seed', updated_at = now()
  WHERE id = v_uid;
END; $fn$;
REVOKE ALL ON FUNCTION public.delete_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_data() TO authenticated;

-- 5. Export all of the caller's data as JSON (portability).
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile',             (SELECT to_jsonb(u) - 'deletion_scheduled_at' FROM public.users u WHERE u.id = v_uid),
    'settings',            (SELECT to_jsonb(s) FROM public.user_settings s WHERE s.user_id = v_uid),
    'walks',               (SELECT coalesce(jsonb_agg(to_jsonb(w)),  '[]'::jsonb) FROM public.walks w               WHERE w.user_id  = v_uid),
    'points_transactions', (SELECT coalesce(jsonb_agg(to_jsonb(p)),  '[]'::jsonb) FROM public.points_transactions p WHERE p.user_id  = v_uid),
    'redeemed_rewards',    (SELECT coalesce(jsonb_agg(to_jsonb(r)),  '[]'::jsonb) FROM public.redeemed_rewards r    WHERE r.user_id  = v_uid),
    'reviews',             (SELECT coalesce(jsonb_agg(to_jsonb(rv)), '[]'::jsonb) FROM public.reviews rv            WHERE rv.user_id = v_uid),
    'achievements',        (SELECT coalesce(jsonb_agg(to_jsonb(ua)), '[]'::jsonb) FROM public.user_achievements ua  WHERE ua.user_id = v_uid),
    'quests',              (SELECT coalesce(jsonb_agg(to_jsonb(uq)), '[]'::jsonb) FROM public.user_quests uq        WHERE uq.user_id = v_uid),
    'saved_places',        (SELECT coalesce(jsonb_agg(to_jsonb(sp)), '[]'::jsonb) FROM public.saved_places sp       WHERE sp.user_id = v_uid),
    'place_contributions', (SELECT coalesce(jsonb_agg(to_jsonb(pc)), '[]'::jsonb) FROM public.place_contributions pc WHERE pc.user_id = v_uid),
    'air_quality_reports', (SELECT coalesce(jsonb_agg(to_jsonb(aq)), '[]'::jsonb) FROM public.air_quality_reports aq WHERE aq.user_id = v_uid)
  ) INTO v_out;
  RETURN v_out;
END; $fn$;
REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;

-- 6. Hard-delete worker (cron). Deletes auth.users → cascades public.users → all child tables.
CREATE OR REPLACE FUNCTION public.process_account_deletions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_count integer := 0; r record;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now() LOOP
    BEGIN
      UPDATE public.merchants SET owner_id = NULL WHERE owner_id = r.id;  -- avoid NO-ACTION FK abort
      DELETE FROM auth.users WHERE id = r.id;                              -- cascades all public data
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'process_account_deletions: failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END; $fn$;
REVOKE ALL ON FUNCTION public.process_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_account_deletions() TO service_role;

-- 7. Daily cron (02:30 UTC, off-peak). Idempotent.
DO $$ BEGIN PERFORM cron.unschedule('breeva-process-account-deletions'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('breeva-process-account-deletions', '30 2 * * *', $$SELECT public.process_account_deletions();$$);
