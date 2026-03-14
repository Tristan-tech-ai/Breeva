-- ============================================
-- VAYU ENGINE — MIGRATION 004: Road-Level Pollution Overlay
-- Adds find_roads_in_bbox() RPC for eLichens-style road pollution rendering
-- ============================================

-- Return road segments with geometry within a bounding box (map viewport).
-- Used by /api/vayu/road-aqi to compute per-road pollution and send
-- GeoJSON to the frontend for colored polyline rendering.
--
-- Priority ordering: major roads first (motorway > primary > residential)
-- so LIMIT doesn't cut important roads at lower zoom levels.
CREATE OR REPLACE FUNCTION find_roads_in_bbox(
  south DOUBLE PRECISION,
  west  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  road_limit INTEGER DEFAULT 200
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
    ST_AsGeoJSON(rs.geom)::TEXT AS geojson,
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
  ORDER BY
    CASE rs.highway
      WHEN 'motorway' THEN 1
      WHEN 'trunk' THEN 2
      WHEN 'primary' THEN 3
      WHEN 'secondary' THEN 4
      WHEN 'tertiary' THEN 5
      WHEN 'residential' THEN 6
      ELSE 7
    END ASC,
    rs.traffic_base_estimate DESC NULLS LAST
  LIMIT road_limit;
END;
$$ LANGUAGE plpgsql STABLE;
