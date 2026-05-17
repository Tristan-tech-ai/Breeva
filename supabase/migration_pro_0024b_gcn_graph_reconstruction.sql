-- Tier 3 Phase 3.0a — Graph Reconstruction (v2)
-- Replaces broken road_graph_edges (all source=0,target=0) with proper PostGIS
-- spatial-join adjacency.  Two edge types:
--   shared_endpoint    (a.end_pt ≈ b.start_pt within p_snap_tolerance_m)
--   spatial_proximity  (K-NN within p_knn_radius_m, capped at p_max_neighbors)

DROP FUNCTION IF EXISTS public.build_gcn_graph(TEXT, REAL, REAL, INT);
DROP TABLE IF EXISTS public.gcn_graph_edges CASCADE;
DROP TABLE IF EXISTS public.gcn_graph_nodes CASCADE;

CREATE TABLE public.gcn_graph_nodes (
  node_id BIGSERIAL PRIMARY KEY,
  osm_way_id BIGINT NOT NULL UNIQUE REFERENCES public.road_segments(osm_way_id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  highway TEXT NOT NULL,
  centroid GEOMETRY(Point, 4326) NOT NULL,
  start_pt GEOMETRY(Point, 4326) NOT NULL,
  end_pt GEOMETRY(Point, 4326) NOT NULL,
  built_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX gcn_nodes_centroid_gix ON public.gcn_graph_nodes USING GIST (centroid);
CREATE INDEX gcn_nodes_start_gix ON public.gcn_graph_nodes USING GIST (start_pt);
CREATE INDEX gcn_nodes_end_gix ON public.gcn_graph_nodes USING GIST (end_pt);
CREATE INDEX gcn_nodes_region_idx ON public.gcn_graph_nodes (region);

CREATE TABLE public.gcn_graph_edges (
  edge_id BIGSERIAL PRIMARY KEY,
  source_node BIGINT NOT NULL REFERENCES public.gcn_graph_nodes(node_id) ON DELETE CASCADE,
  target_node BIGINT NOT NULL REFERENCES public.gcn_graph_nodes(node_id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('shared_endpoint','spatial_proximity')),
  distance_m REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  UNIQUE (source_node, target_node)
);
CREATE INDEX gcn_edges_source_idx ON public.gcn_graph_edges (source_node);
CREATE INDEX gcn_edges_target_idx ON public.gcn_graph_edges (target_node);

CREATE OR REPLACE FUNCTION public.build_gcn_graph(
  p_region TEXT DEFAULT NULL,
  p_snap_tolerance_m REAL DEFAULT 5.0,
  p_knn_radius_m REAL DEFAULT 50.0,
  p_max_neighbors INT DEFAULT 6
) RETURNS TABLE(nodes_inserted INT, edges_inserted INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_node_count INT := 0;
  v_edge_count INT := 0;
  v_tmp INT := 0;
BEGIN
  IF p_region IS NULL THEN
    TRUNCATE public.gcn_graph_nodes RESTART IDENTITY CASCADE;
  ELSE
    DELETE FROM public.gcn_graph_nodes WHERE region = p_region;
  END IF;

  INSERT INTO public.gcn_graph_nodes (osm_way_id, region, highway, centroid, start_pt, end_pt)
  SELECT rs.osm_way_id, rs.region, rs.highway,
         ST_Centroid(rs.geom)::GEOMETRY(Point, 4326),
         ST_StartPoint(rs.geom)::GEOMETRY(Point, 4326),
         ST_EndPoint(rs.geom)::GEOMETRY(Point, 4326)
  FROM public.road_segments rs
  WHERE (p_region IS NULL OR rs.region = p_region)
    AND ST_GeometryType(rs.geom) = 'ST_LineString'
  ON CONFLICT (osm_way_id) DO NOTHING;
  GET DIAGNOSTICS v_node_count = ROW_COUNT;

  INSERT INTO public.gcn_graph_edges (source_node, target_node, edge_type, distance_m, weight)
  SELECT a.node_id, b.node_id, 'shared_endpoint',
         ST_Distance(a.end_pt::GEOGRAPHY, b.start_pt::GEOGRAPHY),
         1.0 / (1.0 + ST_Distance(a.end_pt::GEOGRAPHY, b.start_pt::GEOGRAPHY))
  FROM public.gcn_graph_nodes a
  JOIN public.gcn_graph_nodes b ON a.node_id <> b.node_id
    AND ST_DWithin(a.end_pt::GEOGRAPHY, b.start_pt::GEOGRAPHY, p_snap_tolerance_m)
  WHERE (p_region IS NULL OR (a.region = p_region AND b.region = p_region))
  ON CONFLICT (source_node, target_node) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_edge_count := v_edge_count + v_tmp;

  IF p_max_neighbors > 0 THEN
    WITH knn AS (
      SELECT a.node_id AS src, b.node_id AS tgt,
             ST_Distance(a.centroid::GEOGRAPHY, b.centroid::GEOGRAPHY) AS dist_m,
             ROW_NUMBER() OVER (PARTITION BY a.node_id
               ORDER BY ST_Distance(a.centroid::GEOGRAPHY, b.centroid::GEOGRAPHY)) AS rn
      FROM public.gcn_graph_nodes a
      JOIN public.gcn_graph_nodes b ON a.node_id <> b.node_id
        AND ST_DWithin(a.centroid::GEOGRAPHY, b.centroid::GEOGRAPHY, p_knn_radius_m)
      WHERE (p_region IS NULL OR (a.region = p_region AND b.region = p_region))
    )
    INSERT INTO public.gcn_graph_edges (source_node, target_node, edge_type, distance_m, weight)
    SELECT src, tgt, 'spatial_proximity', dist_m, 0.5 / (1.0 + dist_m / 10.0)
    FROM knn WHERE rn <= p_max_neighbors
    ON CONFLICT (source_node, target_node) DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT;
    v_edge_count := v_edge_count + v_tmp;
  END IF;

  RETURN QUERY SELECT v_node_count, v_edge_count;
END;
$$;
