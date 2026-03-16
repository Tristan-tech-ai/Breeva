-- ============================================================
-- VAYU Migration 009: Dynamic AQI Costs for Road Graph
-- Updates road_graph_edges.aqi_cost using actual pollution
-- indicators from road_segments instead of static highway-type weights.
-- ============================================================
-- Prerequisites: vayu_migration_008_road_graph.sql already applied
-- Run this in Supabase SQL Editor after migration 008.

-- Update aqi_cost using traffic estimates, AI pollution factor,
-- road width, lanes, and landuse — matching the VAYU Gaussian model.
-- This makes pgRouting's Dijkstra produce routes that align with
-- the pollution colors shown on the map.

UPDATE road_graph_edges e
SET aqi_cost = e.length_m * (
  -- Base highway factor (same as before)
  (CASE e.highway
    WHEN 'footway'        THEN 0.3
    WHEN 'path'           THEN 0.3
    WHEN 'pedestrian'     THEN 0.35
    WHEN 'cycleway'       THEN 0.4
    WHEN 'living_street'  THEN 0.5
    WHEN 'service'        THEN 0.85
    WHEN 'residential'    THEN 0.8
    WHEN 'unclassified'   THEN 1.0
    WHEN 'tertiary'       THEN 1.3
    WHEN 'tertiary_link'  THEN 1.3
    WHEN 'secondary'      THEN 1.6
    WHEN 'secondary_link' THEN 1.6
    WHEN 'primary'        THEN 2.0
    WHEN 'primary_link'   THEN 2.0
    WHEN 'trunk'          THEN 2.5
    WHEN 'trunk_link'     THEN 2.5
    WHEN 'motorway'       THEN 3.0
    WHEN 'motorway_link'  THEN 3.0
    ELSE 1.0
  END)
  -- Traffic amplifier: roads with high traffic_base_estimate get penalized
  -- Normalized: 0 traffic → 1.0×, 500 traffic → ~2.0×, 2000+ → ~3.0×
  * (1.0 + LEAST(COALESCE(rs.traffic_base_estimate, 0)::FLOAT / 1000.0, 2.0))
  -- AI pollution factor: Gemini-classified multiplier (default 1.0)
  * COALESCE(rs.ai_pollution_factor, 1.0)
  -- Lane penalty: more lanes = more traffic capacity = more pollution
  * (CASE
      WHEN COALESCE(rs.lanes, 1) >= 4 THEN 1.5
      WHEN COALESCE(rs.lanes, 1) >= 3 THEN 1.3
      WHEN COALESCE(rs.lanes, 1) >= 2 THEN 1.15
      ELSE 1.0
    END)
  -- Width bonus for narrow roads (low traffic) — matches widthFactor logic
  -- Narrow + low traffic = likely gang road = cleaner
  * (CASE
      WHEN rs.width IS NOT NULL AND rs.width < 4 AND COALESCE(rs.traffic_base_estimate, 0) < 50
        THEN 0.7  -- narrow + quiet = bonus
      WHEN rs.width IS NOT NULL AND rs.width < 4 AND COALESCE(rs.traffic_base_estimate, 0) >= 50
        THEN 1.3  -- narrow + busy = canyon trap penalty
      ELSE 1.0
    END)
  -- Landuse modifier: industrial/commercial areas are more polluted
  * (CASE rs.landuse_proxy
      WHEN 'industrial' THEN 1.5
      WHEN 'commercial' THEN 1.2
      WHEN 'retail'     THEN 1.1
      WHEN 'residential' THEN 0.9
      ELSE 1.0
    END)
)
FROM road_segments rs
WHERE e.osm_way_id = rs.osm_way_id;

-- Re-analyze for query planner after cost update
ANALYZE road_graph_edges;

-- ============================================================
-- Also create an RPC to refresh costs periodically (optional)
-- Can be called from a cron job after Gemini re-classifies roads
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_road_graph_costs()
RETURNS void AS $$
BEGIN
  UPDATE road_graph_edges e
  SET aqi_cost = e.length_m * (
    (CASE e.highway
      WHEN 'footway'        THEN 0.3
      WHEN 'path'           THEN 0.3
      WHEN 'pedestrian'     THEN 0.35
      WHEN 'cycleway'       THEN 0.4
      WHEN 'living_street'  THEN 0.5
      WHEN 'service'        THEN 0.85
      WHEN 'residential'    THEN 0.8
      WHEN 'unclassified'   THEN 1.0
      WHEN 'tertiary'       THEN 1.3
      WHEN 'tertiary_link'  THEN 1.3
      WHEN 'secondary'      THEN 1.6
      WHEN 'secondary_link' THEN 1.6
      WHEN 'primary'        THEN 2.0
      WHEN 'primary_link'   THEN 2.0
      WHEN 'trunk'          THEN 2.5
      WHEN 'trunk_link'     THEN 2.5
      WHEN 'motorway'       THEN 3.0
      WHEN 'motorway_link'  THEN 3.0
      ELSE 1.0
    END)
    * (1.0 + LEAST(COALESCE(rs.traffic_base_estimate, 0)::FLOAT / 1000.0, 2.0))
    * COALESCE(rs.ai_pollution_factor, 1.0)
    * (CASE
        WHEN COALESCE(rs.lanes, 1) >= 4 THEN 1.5
        WHEN COALESCE(rs.lanes, 1) >= 3 THEN 1.3
        WHEN COALESCE(rs.lanes, 1) >= 2 THEN 1.15
        ELSE 1.0
      END)
    * (CASE
        WHEN rs.width IS NOT NULL AND rs.width < 4 AND COALESCE(rs.traffic_base_estimate, 0) < 50
          THEN 0.7
        WHEN rs.width IS NOT NULL AND rs.width < 4 AND COALESCE(rs.traffic_base_estimate, 0) >= 50
          THEN 1.3
        ELSE 1.0
      END)
    * (CASE rs.landuse_proxy
        WHEN 'industrial' THEN 1.5
        WHEN 'commercial' THEN 1.2
        WHEN 'retail'     THEN 1.1
        WHEN 'residential' THEN 0.9
        ELSE 1.0
      END)
  )
  FROM road_segments rs
  WHERE e.osm_way_id = rs.osm_way_id;

  ANALYZE road_graph_edges;
END;
$$ LANGUAGE plpgsql;
