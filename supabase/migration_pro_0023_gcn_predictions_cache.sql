-- Tier 3 Phase 3.0.1 — GCN predictions cache table + RPC

CREATE TABLE IF NOT EXISTS public.gcn_road_predictions (
  osm_way_id BIGINT NOT NULL REFERENCES public.road_segments(osm_way_id) ON DELETE CASCADE,
  hour_of_day SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  pm25_delta_gcn REAL NOT NULL,
  uncertainty_sigma REAL NOT NULL DEFAULT 0.5,
  variance_index REAL,
  model_version TEXT NOT NULL,
  predicted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (osm_way_id, hour_of_day)
);

CREATE INDEX IF NOT EXISTS idx_gcn_pred_predicted_at
  ON public.gcn_road_predictions (predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcn_pred_version
  ON public.gcn_road_predictions (model_version);

CREATE OR REPLACE VIEW public.v_gcn_predictions_current AS
SELECT DISTINCT ON (osm_way_id)
  osm_way_id, pm25_delta_gcn, uncertainty_sigma, variance_index, model_version, predicted_at
FROM public.gcn_road_predictions
WHERE hour_of_day = EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Jakarta'))::SMALLINT
ORDER BY osm_way_id, predicted_at DESC;

GRANT SELECT ON public.v_gcn_predictions_current TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_gcn_deltas(p_osm_way_ids BIGINT[])
RETURNS TABLE (
  osm_way_id BIGINT,
  pm25_delta_gcn REAL,
  uncertainty_sigma REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT v.osm_way_id, v.pm25_delta_gcn, v.uncertainty_sigma
  FROM public.v_gcn_predictions_current v
  WHERE v.osm_way_id = ANY(p_osm_way_ids);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.get_gcn_deltas(BIGINT[]) TO anon, authenticated;
