-- ============================================================================
-- Migration 0012 — pg_cron setup (Pro upgrade)
-- ============================================================================
-- Applied 2026-05-15 via Supabase MCP apply_migration.
-- Recorded in supabase_migrations.schema_migrations as `pro_0012_pg_cron_setup`.
--
-- Mirrors 9 cron jobs that previously lived in vercel.json:24-61 + adds a
-- health-ping job that fires every 5 minutes to validate the
-- pg_cron → pg_net → Vercel webhook pipeline.
--
-- POST-APPLY MANUAL STEPS (Tristan, do these in order):
--   1. Generate a 64-hex-char secret:
--        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
--   2. Set BREEVA_CRON_SECRET in Vercel project env vars (same value).
--      Vercel Dashboard → Settings → Environment Variables → Add
--      Apply to: Production, Preview, Development.
--
--   3. Store the same secret in Supabase Vault (one-time):
--        SELECT vault.create_secret('<your_secret>', 'vercel_cron_secret');
--      Run in Supabase Dashboard → SQL Editor.
--
--   4. Add auth guard to each cron-triggered Vercel endpoint:
--        const secret = req.headers['x-breeva-cron-secret'];
--        if (req.query.mode && secret !== process.env.BREEVA_CRON_SECRET) {
--          return res.status(401).json({ error: 'Unauthorized cron trigger' });
--        }
--      Endpoints to guard: api/vayu/road-aqi.ts, api/vayu/gemini-classify.ts,
--      api/vayu/aqi.ts (health-ping target).
--
-- Until step 3 done, cron triggers will fire but Vercel will 401 (graceful
-- no-op; breeva_trigger_vercel() logs a WARNING when vault is empty).
--
-- Verify:
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname LIKE 'breeva-%' OR jobname LIKE 'gemini-%' OR jobname LIKE 'vayu-%';
--   Expected: 10 rows, all active = true.
--
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--   Wait ≥ 5 min after secret set → expect 'succeeded' status entries.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper function: trigger Vercel webhook with Vault-stored secret.
-- SECURITY DEFINER so cron context can read vault.decrypted_secrets.
CREATE OR REPLACE FUNCTION public.breeva_trigger_vercel(
  p_path text,
  p_slug text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'vercel_cron_secret'
    LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE WARNING '[breeva_trigger_vercel] vercel_cron_secret not in vault — skipping % (%)',
      p_slug, p_path;
    RETURN -1;
  END IF;

  SELECT net.http_post(
    url := 'https://breeva.site/api/vayu/' || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-breeva-cron-secret', v_secret,
      'user-agent', 'breeva-pg-cron/1.0'
    ),
    body := jsonb_build_object(
      'triggered_by', 'pg_cron',
      'job', p_slug,
      'triggered_at', NOW()::text
    ),
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.breeva_trigger_vercel(text, text) FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9 cron jobs mirroring vercel.json (already staggered)
-- ─────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'vayu-road-aqi-jakarta-daily',
  '0 0 * * *',
  $$SELECT public.breeva_trigger_vercel(
    'road-aqi?south=-6.22&west=106.80&north=-6.15&east=106.87&zoom=14',
    'road-aqi-jkt'
  )$$
);

SELECT cron.schedule(
  'gemini-classify-bali',
  '30 0 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=bali', 'gem-cl-bali')$$
);

SELECT cron.schedule(
  'gemini-classify-jakarta',
  '35 0 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=jakarta', 'gem-cl-jkt')$$
);

SELECT cron.schedule(
  'gemini-temporal-jakarta',
  '0 6 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=temporal&region=jakarta', 'gem-tmp-jkt')$$
);

SELECT cron.schedule(
  'gemini-temporal-bali',
  '5 6 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=temporal&region=bali', 'gem-tmp-bali')$$
);

SELECT cron.schedule(
  'gemini-temporal-bandung',
  '10 6 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=temporal&region=bandung', 'gem-tmp-bdg')$$
);

SELECT cron.schedule(
  'gemini-temporal-surabaya',
  '15 6 * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=temporal&region=surabaya', 'gem-tmp-sby')$$
);

SELECT cron.schedule(
  'gemini-error-analysis-jakarta',
  '0 3 * * 1',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=error_analysis&region=jakarta', 'gem-err-jkt')$$
);

SELECT cron.schedule(
  'gemini-error-analysis-bali',
  '5 3 * * 1',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=error_analysis&region=bali', 'gem-err-bali')$$
);

-- Health-ping every 5 minutes (sanity check pg_net → Vercel pipeline)
SELECT cron.schedule(
  'breeva-health-ping',
  '*/5 * * * *',
  $$SELECT public.breeva_trigger_vercel('aqi?lat=-6.2&lon=106.8', 'health-ping')$$
);
