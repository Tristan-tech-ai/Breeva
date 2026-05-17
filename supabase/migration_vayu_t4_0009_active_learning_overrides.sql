-- Playbook §2.5 — Per-road prediction sampling rate override.
-- Active learning sampler boosts logging on top-uncertainty roads + reduces on
-- low-uncertainty. road-aqi.ts consults this table before falling back to the
-- global PREDICTION_LOG_SAMPLE env var.

CREATE TABLE IF NOT EXISTS public.region_config_per_road (
  osm_way_id BIGINT PRIMARY KEY REFERENCES public.road_segments(osm_way_id) ON DELETE CASCADE,
  prediction_log_sample_rate_override REAL NOT NULL DEFAULT 0.1
    CHECK (prediction_log_sample_rate_override >= 0 AND prediction_log_sample_rate_override <= 5.0),
  set_at TIMESTAMPTZ DEFAULT NOW(),
  set_by TEXT  -- 'active_learning' | 'cold_start' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_region_config_per_road_set_at
  ON public.region_config_per_road (set_at DESC);

ALTER TABLE public.region_config_per_road ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS region_config_per_road_read ON public.region_config_per_road;
CREATE POLICY region_config_per_road_read ON public.region_config_per_road
  FOR SELECT TO anon, authenticated USING (true);

-- RPC for road-aqi.ts to batch-fetch overrides per viewport
CREATE OR REPLACE FUNCTION public.get_sample_rate_overrides(p_osm_way_ids BIGINT[])
RETURNS TABLE (
  osm_way_id BIGINT,
  rate REAL
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT r.osm_way_id, r.prediction_log_sample_rate_override
  FROM public.region_config_per_road r
  WHERE r.osm_way_id = ANY(p_osm_way_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sample_rate_overrides(BIGINT[]) TO anon, authenticated;
