-- Tier 3 Phase 3.0.2 — Materialized view with pre-joined node features.
-- ADAPTED FROM ORIGINAL: source from gcn_graph_nodes (new table from Phase 3.0a)
-- not road_graph_edges which was broken. Removed pgr_source/pgr_target join — now
-- uses node_id directly from gcn_graph_nodes (proper centroid + edges separated in
-- gcn_graph_edges).

DROP MATERIALIZED VIEW IF EXISTS public.mv_road_graph_nodes CASCADE;

CREATE MATERIALIZED VIEW public.mv_road_graph_nodes AS
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
  gn.node_id                                                  AS gcn_node_id
FROM public.road_segments rs
LEFT JOIN public.gcn_graph_nodes gn ON gn.osm_way_id = rs.osm_way_id
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
