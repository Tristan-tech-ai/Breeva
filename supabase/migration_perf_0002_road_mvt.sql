-- perf_0002: Native PostGIS Mapbox Vector Tile for the road-color layer. One MVT
-- per slippy tile carries every property (aqi + pollutants + deltas + confidence +
-- highway), so MapLibre GL renders crisp GPU vectors and switches color modes
-- client-side (no refetch). Returns base64 text (PostgREST can't stream raw bytea);
-- the serving function (api/vayu/road-aqi ?mvt=1) decodes it. Applied 2026-05-31.
DROP FUNCTION IF EXISTS public.road_mvt(integer, integer, integer);
CREATE OR REPLACE FUNCTION public.road_mvt(z integer, x integer, y integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH bounds AS (
    SELECT ST_TileEnvelope(z, x, y) AS env3857,
           ST_Transform(ST_TileEnvelope(z, x, y), 4326) AS env4326
  )
  SELECT encode(COALESCE(ST_AsMVT(q, 'roads', 4096, 'mvtgeom'), ''::bytea), 'base64')
  FROM (
    SELECT r.aqi, r.pm25, r.no2, r.o3, r.pm10,
           r.pm25_delta, r.no2_delta, r.pm10_delta,
           r.confidence_score, (r.ood_refused)::int AS ood, r.highway,
           ST_AsMVTGeom(ST_Transform(r.geom, 3857), b.env3857, 4096, 64, true) AS mvtgeom
    FROM public.road_aqi_precomputed r, bounds b
    WHERE r.geom && b.env4326 AND r.aqi IS NOT NULL
      AND (z >= 14 OR r.highway IN
        ('motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link'))
  ) q
  WHERE q.mvtgeom IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.road_mvt(integer,integer,integer) TO anon, authenticated, service_role;