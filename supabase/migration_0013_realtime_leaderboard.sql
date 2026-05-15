-- ============================================================================
-- Migration 0013 — Realtime publication for leaderboard_weekly (Pro upgrade)
-- ============================================================================
-- Applied 2026-05-15 via Supabase MCP apply_migration.
-- Recorded as `pro_0013_realtime_leaderboard`.
--
-- Unblocks Hidden Issue H12 (eve/BREEVA_AUDIT_REPORT.md:382-385):
-- "no Supabase Realtime subscription anywhere". On the Free tier this was an
-- intentional skip (2 channel cap). Pro plan provides 500 concurrent channels
-- and 2M messages/month, so live leaderboard updates are feasible.
--
-- After this migration, `src/pages/LeaderboardPage.tsx` can subscribe via:
--   supabase
--     .channel('leaderboard:weekly')
--     .on('postgres_changes',
--         { event: '*', schema: 'public', table: 'leaderboard_weekly' },
--         handler)
--     .subscribe();
--
-- Verify:
--   SELECT pubname, schemaname, tablename
--     FROM pg_publication_tables
--     WHERE pubname = 'supabase_realtime'
--       AND tablename = 'leaderboard_weekly';
--   Expected: 1 row.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.leaderboard_weekly;

-- REPLICA IDENTITY FULL ensures UPDATE events carry the OLD row so subscribers
-- can compute diffs. Trade-off: slightly larger WAL — acceptable for a small
-- ranking table.
ALTER TABLE public.leaderboard_weekly REPLICA IDENTITY FULL;

-- Existing "Anyone can view leaderboard" policy (qual=true) already permits
-- the anon role to receive Realtime events. No new policy needed.
