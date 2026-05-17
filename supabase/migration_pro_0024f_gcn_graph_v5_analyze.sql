-- Tier 3 Phase 3.0a fix v5 — call ANALYZE between INSERT and the edge JOIN so
-- the planner has accurate stats. Without it, large-region runs (palembang 36K,
-- jakarta 139K) pick a hash join on geographies that is effectively a Cartesian
-- product and never finishes. With ANALYZE the planner uses the GiST index scan.

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
  v_snap_deg REAL := p_snap_tolerance_m / 111320.0;
  v_knn_deg REAL  := p_knn_radius_m   / 111320.0;
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

  ANALYZE public.gcn_graph_nodes;

  INSERT INTO public.gcn_graph_edges (source_node, target_node, edge_type, distance_m, weight)
  SELECT a.node_id, b.node_id, 'shared_endpoint',
         ST_Distance(a.end_pt::GEOGRAPHY, b.start_pt::GEOGRAPHY),
         1.0 / (1.0 + ST_Distance(a.end_pt::GEOGRAPHY, b.start_pt::GEOGRAPHY))
  FROM public.gcn_graph_nodes a
  JOIN public.gcn_graph_nodes b ON a.node_id <> b.node_id
    AND ST_DWithin(a.end_pt, b.start_pt, v_snap_deg)
  WHERE (p_region IS NULL OR (a.region = p_region AND b.region = p_region))
  ON CONFLICT (source_node, target_node) DO NOTHING;
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_edge_count := v_edge_count + v_tmp;

  IF p_max_neighbors > 0 THEN
    INSERT INTO public.gcn_graph_edges (source_node, target_node, edge_type, distance_m, weight)
    SELECT a.node_id, nn.node_id, 'spatial_proximity', nn.dist_m,
           0.5 / (1.0 + nn.dist_m / 10.0)
    FROM public.gcn_graph_nodes a
    CROSS JOIN LATERAL (
      SELECT b.node_id,
             ST_Distance(a.centroid::GEOGRAPHY, b.centroid::GEOGRAPHY) AS dist_m
      FROM public.gcn_graph_nodes b
      WHERE b.node_id <> a.node_id
        AND (p_region IS NULL OR b.region = a.region)
        AND ST_DWithin(a.centroid, b.centroid, v_knn_deg)
      ORDER BY a.centroid <-> b.centroid
      LIMIT p_max_neighbors
    ) nn
    WHERE (p_region IS NULL OR a.region = p_region)
    ON CONFLICT (source_node, target_node) DO NOTHING;
    GET DIAGNOSTICS v_tmp = ROW_COUNT;
    v_edge_count := v_edge_count + v_tmp;
  END IF;

  RETURN QUERY SELECT v_node_count, v_edge_count;
END;
$$;
