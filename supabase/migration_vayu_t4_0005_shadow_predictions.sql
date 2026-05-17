-- Tier 4 Phase 4.2 — Shadow predictions cache. Mirror of gcn_road_predictions,
-- written by precompute_gcn.py when a shadow model is registered. Reads at
-- inference time go to the active table; shadow is evaluated offline only.

CREATE TABLE IF NOT EXISTS public.gcn_road_predictions_shadow (
  osm_way_id BIGINT NOT NULL,
  hour_of_day SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  region TEXT NOT NULL,
  pm25_delta_gcn REAL NOT NULL,
  uncertainty_sigma REAL,
  epistemic_sigma REAL,   -- Phase 4.3 ensemble epistemic component
  aleatoric_sigma REAL,   -- Phase 4.3 ensemble aleatoric component
  ensemble_size SMALLINT DEFAULT 1,
  model_version TEXT NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (osm_way_id, hour_of_day)
);

CREATE INDEX IF NOT EXISTS idx_gcn_shadow_region ON public.gcn_road_predictions_shadow(region);
CREATE INDEX IF NOT EXISTS idx_gcn_shadow_version ON public.gcn_road_predictions_shadow(model_version);
