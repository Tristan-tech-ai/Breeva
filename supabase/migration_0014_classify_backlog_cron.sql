-- ============================================================================
-- Migration 0014 — Backlog classify cron (high-frequency, datathon-window)
-- ============================================================================
-- Applied 2026-05-16 via Supabase MCP apply_migration.
-- Recorded as `pro_0014_classify_backlog_cron_v3`.
--
-- Problem: existing daily classify cron (Migration 0012) = 1 batch/day per
-- region × 50 rows/batch = 50 rows/day. Jakarta has 139,203 rows → 7.6 years.
-- Untenable for datathon T-20 deadline.
--
-- Solution: schedule 4 region classify jobs at 12-minute intervals, staggered
-- by 3 minutes so concurrent calls = 1 (avoids Gemini RPM-burst, sequential
-- pacing within Vercel function timeout).
--
-- Math:
--   - 5 calls/region/hour × 4 regions × 24h = 480 calls/day total
--   - Below Gemini free tier 500 RPD limit ✅
--   - 50 rows/call × 480 calls = 24,000 rows/day capacity
--   - Jakarta 139k → ~5.8 days; Bandung+Surabaya ~50k each → ~2 days
--   - Total ~10 days to fully classify all 4 regions (datathon T-20 → fits)
--
-- Staggering:
--   Jakarta:  minutes 0, 12, 24, 36, 48
--   Bali:     minutes 3, 15, 27, 39, 51
--   Bandung:  minutes 6, 18, 30, 42, 54
--   Surabaya: minutes 9, 21, 33, 45, 57
--
-- Post-datathon cleanup (optional, jobs no-op when all classified):
--   SELECT cron.unschedule('gemini-classify-jakarta-backlog');
--   SELECT cron.unschedule('gemini-classify-bali-backlog');
--   SELECT cron.unschedule('gemini-classify-bandung-backlog');
--   SELECT cron.unschedule('gemini-classify-surabaya-backlog');
-- ============================================================================

-- Replace original daily classify cron (jakarta + bali)
DO $$
BEGIN
  PERFORM cron.unschedule('gemini-classify-jakarta');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('gemini-classify-bali');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'gemini-classify-jakarta-backlog',
  '0,12,24,36,48 * * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=jakarta&batch_size=50', 'cl-jkt-bl')$$
);

SELECT cron.schedule(
  'gemini-classify-bali-backlog',
  '3,15,27,39,51 * * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=bali&batch_size=50', 'cl-bali-bl')$$
);

SELECT cron.schedule(
  'gemini-classify-bandung-backlog',
  '6,18,30,42,54 * * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=bandung&batch_size=50', 'cl-bdg-bl')$$
);

SELECT cron.schedule(
  'gemini-classify-surabaya-backlog',
  '9,21,33,45,57 * * * *',
  $$SELECT public.breeva_trigger_vercel('gemini-classify?mode=classify&region=surabaya&batch_size=50', 'cl-sby-bl')$$
);

-- Verify after apply:
--   SELECT jobname, schedule, active FROM cron.job
--   WHERE jobname LIKE '%-backlog'
--   ORDER BY jobname;
-- Expected: 4 rows all active = true.
--
-- Monitor progress per region (run periodically during datathon prep):
--   SELECT region,
--          COUNT(*) AS total,
--          COUNT(ai_pollution_factor) AS classified,
--          ROUND(100.0 * COUNT(ai_pollution_factor) / COUNT(*), 2) AS pct
--   FROM road_segments
--   WHERE region IN ('jakarta','bali','bandung','surabaya')
--   GROUP BY region
--   ORDER BY region;
