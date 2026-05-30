-- Stage 5: serve road-color from road_aqi_precomputed ONLY (no road_segments read).
-- After the table gained geom (generated from stored geojson) + a GIST index, this RPC does the
-- bbox query on the SMALL read-mostly precompute table — eliminating the 1.26GB road_segments
-- cold-disk read from the serve path. Same RETURNS signature as before → handler unchanged.
-- simplify_tolerance is accepted for compat but ignored (geojson is pre-stored at 5-decimal/~1m).
CREATE OR REPLACE FUNCTION public.find_roads_precomputed_in_bbox(
  south double precision, west double precision, north double precision, east double precision,
  road_limit integer DEFAULT 5000, simplify_tolerance double precision DEFAULT 0,
  highway_types character varying[] DEFAULT NULL::character varying[])
RETURNS TABLE(osm_way_id bigint, geojson text, highway character varying,
  pm25 real, no2 real, o3 real, pm10 real, aqi integer,
  pm25_delta real, no2_delta real, pm10_delta real,
  pi95_lo real, pi95_hi real, confidence text, confidence_score real,
  ood_refused boolean, ai_classified boolean, engine text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
SET statement_timeout TO '25000'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    r.osm_way_id, r.geojson, r.highway::varchar,
    r.pm25, r.no2, r.o3, r.pm10, r.aqi,
    r.pm25_delta, r.no2_delta, r.pm10_delta,
    r.pi95_lo, r.pi95_hi, r.confidence, r.confidence_score,
    r.ood_refused, r.ai_classified, r.engine
  FROM public.road_aqi_precomputed r
  WHERE r.geom && ST_MakeEnvelope(west, south, east, north, 4326)
    AND (highway_types IS NULL OR r.highway = ANY(highway_types))
  ORDER BY
    (CASE r.highway
      WHEN 'motorway' THEN 1 WHEN 'motorway_link' THEN 2
      WHEN 'trunk' THEN 3 WHEN 'trunk_link' THEN 4
      WHEN 'primary' THEN 5 WHEN 'primary_link' THEN 6
      WHEN 'secondary' THEN 7 WHEN 'secondary_link' THEN 8
      WHEN 'tertiary' THEN 9 WHEN 'tertiary_link' THEN 10
      WHEN 'unclassified' THEN 11 WHEN 'residential' THEN 12
      WHEN 'living_street' THEN 13 WHEN 'service' THEN 14
      ELSE 15
    END),
    ST_Length(r.geom) DESC
  LIMIT road_limit;
END;
$function$;
