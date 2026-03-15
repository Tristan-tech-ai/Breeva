-- ============================================================
-- VAYU Migration 008: Road Graph for AQI-Optimal Pathfinding
-- Phase 3 of routing algorithm redesign
-- ============================================================
-- Prerequisites: pgRouting available on Supabase instance
-- Run this in Supabase SQL Editor (one-time, may take a few minutes for 642K segments)

-- 1. Enable pgRouting extension
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- 2. Create edges table for pgRouting
-- We copy from road_segments rather than modifying it directly
DROP TABLE IF EXISTS road_graph_edges_vertices_pgr CASCADE;
DROP TABLE IF EXISTS road_graph_edges CASCADE;

CREATE TABLE road_graph_edges (
  id SERIAL PRIMARY KEY,
  osm_way_id BIGINT,
  highway VARCHAR(50),
  name VARCHAR(255),
  length_m DOUBLE PRECISION,
  -- AQI-weighted cost: gang/pedestrian roads are cheap, major roads are expensive
  -- This makes Dijkstra naturally prefer clean (low-traffic) paths
  aqi_cost DOUBLE PRECISION,
  source INTEGER DEFAULT 0,
  target INTEGER DEFAULT 0,
  geom GEOMETRY(LineString, 4326)
);

-- 3. Populate from road_segments with AQI cost weights
-- Cost = length_m × highway_factor
-- Lower factor = cleaner air = preferred by pathfinder
INSERT INTO road_graph_edges (osm_way_id, highway, name, length_m, aqi_cost, geom)
SELECT
  rs.osm_way_id,
  rs.highway,
  rs.name,
  ST_Length(rs.geom::geography) AS length_m,
  ST_Length(rs.geom::geography) * (
    CASE rs.highway
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
    END
  ) AS aqi_cost,
  rs.geom
FROM road_segments rs
WHERE rs.geom IS NOT NULL
  AND ST_GeometryType(rs.geom) = 'ST_LineString';

-- 4. Spatial index on edges
CREATE INDEX idx_road_graph_edges_geom ON road_graph_edges USING GIST (geom);

-- 5. Build topology — snaps endpoints within ~5.5m tolerance (0.00005°)
-- This creates the road_graph_edges_vertices_pgr table automatically
-- with columns: id, cnt, chk, ein, eout, the_geom
SELECT pgr_createTopology('road_graph_edges', 0.00005, 'geom', 'id');

-- 6. Create indexes on source/target for fast Dijkstra lookups
CREATE INDEX idx_road_graph_edges_source ON road_graph_edges (source);
CREATE INDEX idx_road_graph_edges_target ON road_graph_edges (target);

-- 7. Spatial index on vertices for nearest-vertex queries
CREATE INDEX idx_road_graph_vertices_geom ON road_graph_edges_vertices_pgr USING GIST (the_geom);

-- 8. Analyze tables for query optimizer
ANALYZE road_graph_edges;
ANALYZE road_graph_edges_vertices_pgr;

-- ============================================================
-- 9. AQI-optimal routing function
-- Returns route as ordered sequence of road edges
-- ============================================================
CREATE OR REPLACE FUNCTION find_aqi_optimal_route(
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  end_lat   DOUBLE PRECISION,
  end_lng   DOUBLE PRECISION,
  corridor_buffer DOUBLE PRECISION DEFAULT 0.008
)
RETURNS TABLE (
  seq        INTEGER,
  osm_way_id BIGINT,
  highway    VARCHAR,
  name       VARCHAR,
  length_m   DOUBLE PRECISION,
  aqi_cost   DOUBLE PRECISION,
  geojson    TEXT
) AS $$
DECLARE
  start_vertex INTEGER;
  end_vertex   INTEGER;
  c_south DOUBLE PRECISION;
  c_north DOUBLE PRECISION;
  c_west  DOUBLE PRECISION;
  c_east  DOUBLE PRECISION;
BEGIN
  -- Corridor bounds (generous buffer to avoid cutting off paths)
  c_south := LEAST(start_lat, end_lat) - corridor_buffer;
  c_north := GREATEST(start_lat, end_lat) + corridor_buffer;
  c_west  := LEAST(start_lng, end_lng) - corridor_buffer;
  c_east  := GREATEST(start_lng, end_lng) + corridor_buffer;

  -- Find nearest graph vertex to start point
  SELECT v.id INTO start_vertex
  FROM road_graph_edges_vertices_pgr v
  WHERE v.the_geom && ST_MakeEnvelope(
    start_lng - 0.003, start_lat - 0.003,
    start_lng + 0.003, start_lat + 0.003, 4326)
  ORDER BY v.the_geom <-> ST_SetSRID(ST_MakePoint(start_lng, start_lat), 4326)
  LIMIT 1;

  -- Find nearest graph vertex to end point
  SELECT v.id INTO end_vertex
  FROM road_graph_edges_vertices_pgr v
  WHERE v.the_geom && ST_MakeEnvelope(
    end_lng - 0.003, end_lat - 0.003,
    end_lng + 0.003, end_lat + 0.003, 4326)
  ORDER BY v.the_geom <-> ST_SetSRID(ST_MakePoint(end_lng, end_lat), 4326)
  LIMIT 1;

  -- No vertices found near start/end → return empty
  IF start_vertex IS NULL OR end_vertex IS NULL THEN
    RETURN;
  END IF;

  -- Same vertex = already at destination
  IF start_vertex = end_vertex THEN
    RETURN;
  END IF;

  -- Run corridor-scoped Dijkstra with AQI-weighted costs
  -- undirected = true (pedestrians can walk both ways)
  RETURN QUERY
  SELECT
    d.path_seq::INTEGER AS seq,
    e.osm_way_id,
    e.highway,
    e.name,
    e.length_m,
    e.aqi_cost,
    ST_AsGeoJSON(e.geom)::TEXT AS geojson
  FROM pgr_dijkstra(
    format(
      'SELECT id, source, target, aqi_cost AS cost, aqi_cost AS reverse_cost
       FROM road_graph_edges
       WHERE geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)',
      c_west, c_south, c_east, c_north
    ),
    start_vertex,
    end_vertex,
    directed := false
  ) AS d
  JOIN road_graph_edges e ON d.edge = e.id
  WHERE d.edge > 0
  ORDER BY d.path_seq;
END;
$$ LANGUAGE plpgsql STABLE;
