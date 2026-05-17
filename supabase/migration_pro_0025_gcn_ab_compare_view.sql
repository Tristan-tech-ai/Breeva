-- Tier 3 Phase 3.8 — A/B comparison view: baseline (CALINE3) vs +XGBoost vs +GCN
-- Joins prediction_logs with gcn_road_predictions for same hour, computes MAE per
-- stage. Used by judges-facing "Spatial AI accuracy" sidebar metric + demo storyline.

CREATE OR REPLACE VIEW public.v_gcn_ab_compare AS
WITH recent AS (
  SELECT
    pl.osm_way_id,
    pl.predicted_pm25 AS baseline_pm25,
    pl.corrected_pm25 AS post_xgboost,
    pl.ground_truth_pm25,
    g.pm25_delta_gcn,
    (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(g.pm25_delta_gcn, 0))::REAL AS post_gcn,
    pl.predicted_at
  FROM public.prediction_logs pl
  LEFT JOIN public.gcn_road_predictions g
    ON g.osm_way_id = pl.osm_way_id
   AND g.hour_of_day = EXTRACT(HOUR FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT
  WHERE pl.ground_truth_pm25 IS NOT NULL
    AND pl.predicted_at > NOW() - INTERVAL '14 days'
)
SELECT
  COUNT(*)::INT AS n,
  AVG(ABS(baseline_pm25 - ground_truth_pm25))::REAL AS mae_baseline,
  AVG(ABS(COALESCE(post_xgboost, baseline_pm25) - ground_truth_pm25))::REAL AS mae_xgboost,
  AVG(ABS(post_gcn - ground_truth_pm25))::REAL AS mae_gcn,
  AVG(post_gcn - COALESCE(post_xgboost, baseline_pm25))::REAL AS mean_gcn_delta,
  STDDEV(post_gcn - COALESCE(post_xgboost, baseline_pm25))::REAL AS std_gcn_delta
FROM recent;

GRANT SELECT ON public.v_gcn_ab_compare TO anon, authenticated;
