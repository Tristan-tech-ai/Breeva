-- Fix Supabase advisor warnings from Tier 3 + Tier 4 migrations.
-- 1) Three views were running SECURITY DEFINER by default. Switch to security_invoker.
-- 2) Six new tables exposed via PostgREST lacked explicit RLS. Enable + permissive read.

-- ─── views: security_invoker = on ──────────────────────────────────────
ALTER VIEW public.v_online_mae_24h SET (security_invoker = on);
ALTER VIEW public.v_gcn_predictions_current SET (security_invoker = on);
ALTER VIEW public.v_gcn_ab_compare SET (security_invoker = on);

-- ─── tables: enable RLS + add permissive read policy ──────────────────
-- ML output / graph topology — read-only for app users. Writes happen via
-- service-role only (precompute_gcn.py / build_gcn_graph / snapshot_stations.py).

ALTER TABLE public.gcn_road_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcn_road_predictions_read ON public.gcn_road_predictions;
CREATE POLICY gcn_road_predictions_read ON public.gcn_road_predictions
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.gcn_road_predictions_shadow ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcn_road_predictions_shadow_read ON public.gcn_road_predictions_shadow;
CREATE POLICY gcn_road_predictions_shadow_read ON public.gcn_road_predictions_shadow
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.stgcn_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stgcn_predictions_read ON public.stgcn_predictions;
CREATE POLICY stgcn_predictions_read ON public.stgcn_predictions
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.gcn_graph_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcn_graph_nodes_read ON public.gcn_graph_nodes;
CREATE POLICY gcn_graph_nodes_read ON public.gcn_graph_nodes
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.gcn_graph_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gcn_graph_edges_read ON public.gcn_graph_edges;
CREATE POLICY gcn_graph_edges_read ON public.gcn_graph_edges
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.station_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS station_snapshots_read ON public.station_snapshots;
CREATE POLICY station_snapshots_read ON public.station_snapshots
  FOR SELECT TO anon, authenticated USING (true);

-- NOTE: spatial_ref_sys is a PostGIS-managed table; Supabase docs document it
-- as a known false-positive (cannot enable RLS without breaking PostGIS).
-- See: https://supabase.com/docs/guides/database/database-linter
