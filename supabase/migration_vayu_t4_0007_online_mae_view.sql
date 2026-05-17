-- Tier 4 Phase 4.3 Step 4.3.5 — online MAE + PI95 coverage views per region.
-- Used by drift_monitor.py + promote_shadow.py + judges-facing sidebar.

CREATE OR REPLACE VIEW public.v_online_mae_24h AS
SELECT
  pl.region,
  ml.version AS model_version,
  COUNT(*)::INT AS n,
  AVG(ABS(COALESCE(pl.corrected_pm25, pl.predicted_pm25) - pl.ground_truth_pm25))::REAL AS mae_baseline,
  AVG(ABS(
    (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(g.pm25_delta_gcn, 0))
    - pl.ground_truth_pm25
  ))::REAL AS mae_with_gcn,
  AVG(g.uncertainty_sigma)::REAL AS avg_sigma_total,
  AVG(g.epistemic_sigma)::REAL AS avg_sigma_epistemic,
  AVG(g.aleatoric_sigma)::REAL AS avg_sigma_aleatoric,
  (COUNT(*) FILTER (
    WHERE ABS(
      (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(g.pm25_delta_gcn, 0))
      - pl.ground_truth_pm25
    ) < 1.96 * GREATEST(COALESCE(g.uncertainty_sigma, 0.5), 0.1)
  )::REAL / NULLIF(COUNT(*), 0))::REAL AS pi95_coverage
FROM public.prediction_logs pl
LEFT JOIN public.gcn_road_predictions g
  ON g.osm_way_id = pl.osm_way_id
 AND g.hour_of_day = EXTRACT(HOUR FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT
LEFT JOIN public.ml_model_registry ml
  ON ml.active AND ml.model_name = 'gcn_road'
WHERE pl.ground_truth_pm25 IS NOT NULL
  AND pl.predicted_at > NOW() - INTERVAL '24 hours'
GROUP BY pl.region, ml.version;

CREATE OR REPLACE VIEW public.v_online_mae_24h_shadow AS
SELECT
  pl.region,
  ml.version AS shadow_version,
  COUNT(*)::INT AS n,
  AVG(ABS(
    (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(gs.pm25_delta_gcn, 0))
    - pl.ground_truth_pm25
  ))::REAL AS mae_with_gcn_shadow,
  (COUNT(*) FILTER (
    WHERE ABS(
      (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(gs.pm25_delta_gcn, 0))
      - pl.ground_truth_pm25
    ) < 1.96 * GREATEST(COALESCE(gs.uncertainty_sigma, 0.5), 0.1)
  )::REAL / NULLIF(COUNT(*), 0))::REAL AS pi95_coverage_shadow
FROM public.prediction_logs pl
LEFT JOIN public.gcn_road_predictions_shadow gs
  ON gs.osm_way_id = pl.osm_way_id
 AND gs.hour_of_day = EXTRACT(HOUR FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT
LEFT JOIN public.ml_model_registry ml
  ON ml.shadow AND ml.model_name = 'gcn_road'
WHERE pl.ground_truth_pm25 IS NOT NULL
  AND pl.predicted_at > NOW() - INTERVAL '24 hours'
GROUP BY pl.region, ml.version;

GRANT SELECT ON public.v_online_mae_24h TO anon, authenticated;
GRANT SELECT ON public.v_online_mae_24h_shadow TO anon, authenticated;
