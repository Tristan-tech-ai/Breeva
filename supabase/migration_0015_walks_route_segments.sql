-- migration_0015_walks_route_segments.sql
-- Store the v2-scored per-segment AQI computed at walk completion so the Exposure
-- (Paparan) page can dose a saved walk WITHOUT a live route-score round-trip
-- (previously 2–10 s: serverless cold-start + mobile network + possible live-CALINE).
-- The captured segments also reflect the air at walk-time, which is more correct
-- for that specific walk than re-scoring against current AQI.
--
-- Applied to remote 2026-06-02 via MCP apply_migration (add_route_segments_to_walks);
-- this file mirrors it for the git-tracked schema SSOT.

ALTER TABLE public.walks ADD COLUMN IF NOT EXISTS route_segments jsonb;

COMMENT ON COLUMN public.walks.route_segments IS
  'v2 route-score segments (RouteSegmentAQI[]) captured at completion; lets Paparan dose the walk without a live route-score round-trip.';

-- Write path: src/stores/walkStore.ts endWalk() best-effort updates this after the
--   walk row is saved (RLS "Users can update own walks": auth.uid() = user_id).
-- Read path: src/components/exposure/RouteSelector.tsx selects route_segments and
--   doses the walk instantly when present, falling back to a (client-cached)
--   route-score call for older walks that predate this column.
