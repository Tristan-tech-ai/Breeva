-- ============================================
-- VAYU ENGINE — MIGRATION 007: Through-Road Detection
-- Adds find_through_gang_roads() RPC that returns only gang/pedestrian
-- roads where BOTH endpoints connect to other roads (not dead-ends).
-- Used by clean-route gang road injection to avoid dead-end waypoints.
-- ============================================

CREATE OR REPLACE FUNCTION find_through_gang_roads(
  south DOUBLE PRECISION,
  west  DOUBLE PRECISION,
  north DOUBLE PRECISION,
  east  DOUBLE PRECISION,
  road_limit INTEGER DEFAULT 20,
  connection_distance_m FLOAT DEFAULT 5.0
)
RETURNS TABLE (
  osm_way_id BIGINT,
  geojson TEXT,
  highway VARCHAR,
  name VARCHAR,
  road_length_m FLOAT,
  start_connections INT,
  end_connections INT
) AS $$
BEGIN
  RETURN QUERY
  WITH gang_roads AS (
    SELECT
      rs.osm_way_id,
      ST_AsGeoJSON(rs.geom)::TEXT AS geojson,
      rs.highway,
      rs.name,
      ST_Length(rs.geom::geography) AS road_length_m,
      ST_StartPoint(rs.geom) AS start_pt,
      ST_EndPoint(rs.geom) AS end_pt,
      rs.geom
    FROM road_segments rs
    WHERE rs.geom && ST_MakeEnvelope(west, south, east, north, 4326)
      AND rs.highway IN ('living_street', 'path', 'footway', 'pedestrian')
      AND ST_Length(rs.geom::geography) > 20  -- skip very short stubs
  ),
  with_connections AS (
    SELECT
      gr.osm_way_id,
      gr.geojson,
      gr.highway,
      gr.name,
      gr.road_length_m,
      (SELECT COUNT(DISTINCT rs2.osm_way_id)
       FROM road_segments rs2
       WHERE rs2.osm_way_id != gr.osm_way_id
         AND ST_DWithin(rs2.geom::geography, gr.start_pt::geography, connection_distance_m)
      )::INT AS start_connections,
      (SELECT COUNT(DISTINCT rs2.osm_way_id)
       FROM road_segments rs2
       WHERE rs2.osm_way_id != gr.osm_way_id
         AND ST_DWithin(rs2.geom::geography, gr.end_pt::geography, connection_distance_m)
      )::INT AS end_connections
    FROM gang_roads gr
  )
  SELECT
    wc.osm_way_id,
    wc.geojson,
    wc.highway,
    wc.name,
    wc.road_length_m,
    wc.start_connections,
    wc.end_connections
  FROM with_connections wc
  WHERE wc.start_connections > 0 AND wc.end_connections > 0  -- BOTH ends connect
  ORDER BY wc.road_length_m DESC  -- prefer longer through-roads
  LIMIT road_limit;
END;
$$ LANGUAGE plpgsql STABLE;
