-- Tier 4 Phase 4.4 — per-road 24h PM2.5 forecasts emitted by ST-GNN.
-- Written hourly by vayu/ml/precompute_stgcn.py. Each anchor row has 24
-- hourly forecasts. Older anchors are pruned to keep last 72 h of history.

CREATE TABLE IF NOT EXISTS public.stgcn_predictions (
  osm_way_id BIGINT NOT NULL,
  forecast_anchor TIMESTAMPTZ NOT NULL,
  forecast_hour SMALLINT NOT NULL CHECK (forecast_hour BETWEEN 0 AND 23),
  predicted_pm25 REAL NOT NULL,
  uncertainty_sigma REAL,
  epistemic_sigma REAL,
  aleatoric_sigma REAL,
  model_version TEXT NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (osm_way_id, forecast_anchor, forecast_hour)
);

CREATE INDEX IF NOT EXISTS idx_stgcn_anchor ON public.stgcn_predictions(forecast_anchor DESC);
CREATE INDEX IF NOT EXISTS idx_stgcn_osm_anchor ON public.stgcn_predictions(osm_way_id, forecast_anchor DESC);

-- RPC for the road-forecast endpoint
CREATE OR REPLACE VIEW public.v_stgcn_predictions_latest AS
SELECT DISTINCT ON (osm_way_id, forecast_hour)
  osm_way_id, forecast_anchor, forecast_hour, predicted_pm25,
  uncertainty_sigma, epistemic_sigma, aleatoric_sigma, model_version, computed_at
FROM public.stgcn_predictions
WHERE forecast_anchor > NOW() - INTERVAL '6 hours'
ORDER BY osm_way_id, forecast_hour, forecast_anchor DESC;

GRANT SELECT ON public.v_stgcn_predictions_latest TO anon, authenticated;
GRANT SELECT ON public.stgcn_predictions TO anon, authenticated;
