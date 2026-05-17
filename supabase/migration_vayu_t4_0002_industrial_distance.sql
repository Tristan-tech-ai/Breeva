-- Tier 4 Phase 4.1 — distance from each road centroid to nearest
-- industrial/commercial/retail landuse polygon.
--
-- Column-only migration for now. Backfill function defined but not run because
-- osm_landuse polygon table isn't yet ingested. Once ingested, run:
--   SELECT public.backfill_industrial_distance();

ALTER TABLE public.road_segments
  ADD COLUMN IF NOT EXISTS dist_industrial_m REAL DEFAULT 5000.0;

CREATE INDEX IF NOT EXISTS idx_road_dist_industrial
  ON public.road_segments(dist_industrial_m);

CREATE OR REPLACE FUNCTION public.backfill_industrial_distance()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE updated INT;
BEGIN
  WITH industrial_polys AS (
    SELECT geom FROM public.osm_landuse
    WHERE landuse_type IN ('industrial', 'commercial', 'retail')
  ),
  road_dist AS (
    SELECT
      rs.osm_way_id,
      MIN(ST_DistanceSphere(ST_LineInterpolatePoint(rs.geom, 0.5), ip.geom)) AS dist_m
    FROM public.road_segments rs
    CROSS JOIN industrial_polys ip
    WHERE ST_DWithin(
      ST_LineInterpolatePoint(rs.geom, 0.5)::geography,
      ip.geom::geography,
      5000
    )
    GROUP BY rs.osm_way_id
  )
  UPDATE public.road_segments rs
  SET dist_industrial_m = LEAST(rd.dist_m, 5000.0)::REAL
  FROM road_dist rd
  WHERE rs.osm_way_id = rd.osm_way_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;
