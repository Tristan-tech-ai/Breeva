-- ============================================
-- VAYU ENGINE — MIGRATION 004: Road-Level Pollution Overlay
-- Adds find_roads_in_bbox() RPC for eLichens-style road pollution rendering
-- Supports zoom-aware geometry simplification + coordinate precision
-- ============================================

-- Return road segments with geometry within a bounding box (map viewport).
-- Used by /api/vayu/road-aqi to compute per-road pollution and send
-- GeoJSON to the frontend for colored polyline rendering.
--
-- simplify_tolerance: ST_SimplifyPreserveTopology tolerance in degrees
--   0 = full detail, 0.001 = ~100m (for z10), 0.0001 = ~10m (for z13)
DROP FUNCTION IF EXISTS find_roads_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);
DROP FUNCTION IF EXISTS find_roads_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION find_roads_in_bbox(
  south DOUBLE PRECISION,
  west  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  road_limit INTEGER DEFAULT 200,
  simplify_tolerance DOUBLE PRECISION DEFAULT 0
)
RETURNS TABLE (
  osm_way_id BIGINT,
  geojson TEXT,
  highway VARCHAR,
  lanes SMALLINT,
  width DECIMAL,
  canyon_ratio DECIMAL,
  landuse_proxy VARCHAR,
  traffic_base_estimate INTEGER,
  traffic_calibration_factor DECIMAL,
  name VARCHAR,
  surface VARCHAR,
  elevation_avg DECIMAL,
  micro_class VARCHAR,
  ai_pollution_factor DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rs.osm_way_id,
    CASE
      WHEN simplify_tolerance > 0 THEN
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(rs.geom, simplify_tolerance), 5)::TEXT
      ELSE
        ST_AsGeoJSON(rs.geom, 5)::TEXT
    END AS geojson,
    rs.highway,
    rs.lanes,
    rs.width,
    rs.canyon_ratio,
    rs.landuse_proxy,
    rs.traffic_base_estimate,
    rs.traffic_calibration_factor,
    rs.name,
    rs.surface,
    rs.elevation_avg,
    rs.micro_class,
    rs.ai_pollution_factor
  FROM road_segments rs
  WHERE rs.geom && ST_MakeEnvelope(west, south, east, north, 4326)
  ORDER BY rs.osm_way_id
  LIMIT road_limit;
END;
$$ LANGUAGE plpgsql STABLE;
