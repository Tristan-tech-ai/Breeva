-- ============================================
-- VAYU ENGINE — MIGRATION 006: Route-Level Road Matching
-- Adds find_roads_along_route() RPC for clean-route scoring.
-- Finds road_segments within a buffer of a route LineString,
-- ordered by position along the route.
-- ============================================

CREATE OR REPLACE FUNCTION find_roads_along_route(
  route_geojson TEXT,
  buffer_meters FLOAT DEFAULT 30
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
  ai_pollution_factor DECIMAL,
  fraction_along FLOAT
) AS $$
DECLARE
  route_geom GEOMETRY;
BEGIN
  -- Parse GeoJSON to geometry
  route_geom := ST_SetSRID(ST_GeomFromGeoJSON(route_geojson), 4326);

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
    rs.ai_pollution_factor,
    ST_LineLocatePoint(route_geom, ST_Centroid(rs.geom))::FLOAT AS fraction_along
  FROM road_segments rs
  WHERE ST_DWithin(
    rs.geom::geography,
    route_geom::geography,
    buffer_meters
  )
  ORDER BY ST_LineLocatePoint(route_geom, ST_Centroid(rs.geom));
END;
$$ LANGUAGE plpgsql STABLE;

-- Geography cast index for faster ST_DWithin on long routes
CREATE INDEX IF NOT EXISTS idx_road_geom_geog
  ON road_segments USING GIST ((geom::geography));
