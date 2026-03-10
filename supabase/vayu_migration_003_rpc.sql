-- ============================================
-- VAYU ENGINE — RPC FUNCTIONS FOR SPATIAL QUERIES
-- Required for Mode A (Vercel serverless) to query road_segments via PostgREST
-- ============================================

-- Find nearest road segments within radius (meters) of a point
-- Uses bounding box pre-filter (&&) to leverage existing GiST index on geom,
-- then accurate geography distance as a secondary filter.
CREATE OR REPLACE FUNCTION find_nearby_roads(
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  radius_m INTEGER DEFAULT 500,
  max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
  osm_way_id BIGINT,
  highway VARCHAR,
  lanes SMALLINT,
  width DECIMAL,
  surface VARCHAR,
  maxspeed SMALLINT,
  landuse_proxy VARCHAR,
  canyon_ratio DECIMAL,
  traffic_base_estimate INTEGER,
  traffic_calibration_factor DECIMAL,
  distance_m DOUBLE PRECISION
) AS $$
DECLARE
  search_point GEOMETRY;
  degree_radius DOUBLE PRECISION;
BEGIN
  search_point := ST_SetSRID(ST_MakePoint(lon, lat), 4326);
  -- Convert meters to approximate degrees (1 degree ≈ 111320m at equator, safe for Indonesia)
  degree_radius := radius_m / 111320.0;

  RETURN QUERY
  SELECT
    rs.osm_way_id,
    rs.highway,
    rs.lanes,
    rs.width,
    rs.surface,
    rs.maxspeed,
    rs.landuse_proxy,
    rs.canyon_ratio,
    rs.traffic_base_estimate,
    rs.traffic_calibration_factor,
    ST_Distance(rs.geom::geography, search_point::geography) AS distance_m
  FROM road_segments rs
  WHERE rs.geom && ST_Expand(search_point, degree_radius)
    AND ST_Distance(rs.geom::geography, search_point::geography) <= radius_m
  ORDER BY distance_m ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Upsert AQI grid tile (called from Mode A serverless)
CREATE OR REPLACE FUNCTION upsert_aqi_tile(
  p_tile_id VARCHAR,
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_aqi INTEGER,
  p_pm25 DECIMAL,
  p_pm10 DECIMAL,
  p_no2 DECIMAL,
  p_co DECIMAL,
  p_o3 DECIMAL,
  p_confidence DECIMAL,
  p_layer_source SMALLINT,
  p_valid_minutes INTEGER DEFAULT 15
)
RETURNS void AS $$
BEGIN
  INSERT INTO aqi_grid (tile_id, geom, aqi, pm25, pm10, no2, co, o3, confidence, layer_source, hit_count, computed_at, valid_until)
  VALUES (
    p_tile_id,
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326),
    p_aqi, p_pm25, p_pm10, p_no2, p_co, p_o3,
    p_confidence, p_layer_source, 1,
    NOW(), NOW() + (p_valid_minutes || ' minutes')::INTERVAL
  )
  ON CONFLICT (tile_id) DO UPDATE SET
    aqi = CASE
      -- Don't overwrite Mode B (layer_source=2) with Mode A (layer_source=1) unless stale
      WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW()
        THEN aqi_grid.aqi
      ELSE EXCLUDED.aqi
    END,
    pm25 = CASE WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW() THEN aqi_grid.pm25 ELSE EXCLUDED.pm25 END,
    pm10 = CASE WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW() THEN aqi_grid.pm10 ELSE EXCLUDED.pm10 END,
    no2 = CASE WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW() THEN aqi_grid.no2 ELSE EXCLUDED.no2 END,
    co = CASE WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW() THEN aqi_grid.co ELSE EXCLUDED.co END,
    o3 = CASE WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW() THEN aqi_grid.o3 ELSE EXCLUDED.o3 END,
    confidence = CASE
      WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW()
        THEN GREATEST(0.35, aqi_grid.confidence - 0.05)
      ELSE EXCLUDED.confidence
    END,
    layer_source = CASE
      WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW()
        THEN aqi_grid.layer_source
      ELSE EXCLUDED.layer_source
    END,
    hit_count = aqi_grid.hit_count + 1,
    computed_at = CASE
      WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW()
        THEN aqi_grid.computed_at
      ELSE NOW()
    END,
    valid_until = CASE
      WHEN aqi_grid.layer_source >= 2 AND EXCLUDED.layer_source < 2 AND aqi_grid.valid_until > NOW()
        THEN aqi_grid.valid_until
      ELSE NOW() + (p_valid_minutes || ' minutes')::INTERVAL
    END;
END;
$$ LANGUAGE plpgsql;
