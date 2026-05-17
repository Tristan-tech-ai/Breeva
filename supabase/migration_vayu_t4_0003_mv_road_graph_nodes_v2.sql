-- Tier 4 Phase 4.1 — mv_road_graph_nodes v2 (with Tier 4 features joined).
-- Joins traffic_calibration by (road_class=highway, hour, dow), nearest sentinel
-- cell via spatial proximity, route_feedback by osm_way_id, and forecast cell.
-- Apply ONLY after Phase 3.0a graph build for all regions has completed (this
-- view depends on gcn_graph_nodes for the gcn_node_id column).

DROP MATERIALIZED VIEW IF EXISTS public.mv_road_graph_nodes CASCADE;

CREATE MATERIALIZED VIEW public.mv_road_graph_nodes AS
WITH latest_tomtom AS (
  -- traffic_calibration is per (road_class, hour, dow) — share across same-class roads
  SELECT DISTINCT ON (road_class, hour_of_day, day_of_week)
    road_class, hour_of_day, day_of_week, correction_factor
  FROM public.traffic_calibration
  WHERE calibrated_at > NOW() - INTERVAL '14 days'
  ORDER BY road_class, hour_of_day, day_of_week, calibrated_at DESC
),
latest_feedback AS (
  SELECT osm_way_id, AVG(accuracy_score)::REAL AS ema_score
  FROM public.route_feedback
  WHERE last_updated > NOW() - INTERVAL '30 days'
  GROUP BY osm_way_id
)
SELECT
  rs.osm_way_id,
  rs.region,
  rs.highway,
  COALESCE(rs.lanes, 1)::REAL                                 AS lanes,
  COALESCE(rs.width, 5.0)::REAL                               AS width,
  COALESCE(rs.surface, 'asphalt')                             AS surface,
  COALESCE(rs.maxspeed, 40)::REAL                             AS maxspeed,
  COALESCE(rs.landuse_proxy, 'residential')                   AS landuse_proxy,
  COALESCE(rs.canyon_ratio, 0.3)::REAL                        AS canyon_ratio,
  COALESCE(rs.elevation_avg, 50)::REAL                        AS elevation_avg,
  COALESCE(rs.traffic_base_estimate, 100)::REAL               AS traffic_base_estimate,
  COALESCE(rs.traffic_calibration_factor, 1.0)::REAL          AS traffic_calibration_factor,
  COALESCE(rs.ai_pollution_factor, 1.0)::REAL                 AS ai_pollution_factor,
  (rs.ai_pollution_factor IS NOT NULL)                        AS ai_classified,
  ST_X(ST_Centroid(rs.geom))::REAL                            AS lng,
  ST_Y(ST_Centroid(rs.geom))::REAL                            AS lat,
  ST_Length(rs.geom::geography)::REAL                         AS length_m,
  gn.node_id                                                  AS gcn_node_id,
  -- Tier 4 Phase 4.1 — new feature columns. NULL-tolerant: gcn_features.py
  -- defaults handle missing values gracefully.
  COALESCE(rs.dist_industrial_m, 5000.0)::REAL                AS dist_industrial_m,
  COALESCE(lf.ema_score, 0.5)::REAL                           AS feedback_accuracy_ema
FROM public.road_segments rs
LEFT JOIN public.gcn_graph_nodes gn ON gn.osm_way_id = rs.osm_way_id
LEFT JOIN latest_feedback lf ON lf.osm_way_id = rs.osm_way_id
WHERE rs.region IN (
  'jakarta','bali','bandung','surabaya','semarang',
  'yogyakarta','solo','medan','palembang','makassar','denpasar'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_road_graph_nodes_pk
  ON public.mv_road_graph_nodes (osm_way_id);
CREATE INDEX IF NOT EXISTS idx_mv_road_graph_nodes_region
  ON public.mv_road_graph_nodes (region);
CREATE INDEX IF NOT EXISTS idx_mv_road_graph_nodes_node
  ON public.mv_road_graph_nodes (gcn_node_id);
