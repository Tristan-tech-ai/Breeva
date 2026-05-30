-- Serve RPC for the road-color precompute (USE_PRECOMPUTE fast-path). Same bbox pick as
-- find_roads_in_bbox, but LEFT JOINs road_aqi_precomputed so the handler gets geometry + the
-- stored v2 values in ONE query — skipping CALINE4/Background/GP compute + Open-Meteo/WAQI/
-- satellite fetches. Applied to the DB 2026-05-30 (this file is the repo record).
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
  WITH picked AS (
    SELECT
      rs.osm_way_id, rs.geom, rs.highway,
      (CASE rs.highway
        WHEN 'motorway' THEN 1 WHEN 'motorway_link' THEN 2
        WHEN 'trunk' THEN 3 WHEN 'trunk_link' THEN 4
        WHEN 'primary' THEN 5 WHEN 'primary_link' THEN 6
        WHEN 'secondary' THEN 7 WHEN 'secondary_link' THEN 8
        WHEN 'tertiary' THEN 9 WHEN 'tertiary_link' THEN 10
        WHEN 'unclassified' THEN 11 WHEN 'residential' THEN 12
        WHEN 'living_street' THEN 13 WHEN 'service' THEN 14
        ELSE 15
      END) AS hw_prio,
      ST_Length(rs.geom) AS plen
    FROM public.road_segments rs
    WHERE rs.geom && ST_MakeEnvelope(west, south, east, north, 4326)
      AND (highway_types IS NULL OR rs.highway = ANY(highway_types))
    ORDER BY
      (CASE rs.highway
        WHEN 'motorway' THEN 1 WHEN 'motorway_link' THEN 2
        WHEN 'trunk' THEN 3 WHEN 'trunk_link' THEN 4
        WHEN 'primary' THEN 5 WHEN 'primary_link' THEN 6
        WHEN 'secondary' THEN 7 WHEN 'secondary_link' THEN 8
        WHEN 'tertiary' THEN 9 WHEN 'tertiary_link' THEN 10
        WHEN 'unclassified' THEN 11 WHEN 'residential' THEN 12
        WHEN 'living_street' THEN 13 WHEN 'service' THEN 14
        ELSE 15
      END),
      ST_Length(rs.geom) DESC
    LIMIT road_limit
  )
  SELECT
    p.osm_way_id,
    CASE
      WHEN simplify_tolerance > 0
        THEN ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, simplify_tolerance), 5)::text
      ELSE ST_AsGeoJSON(p.geom, 5)::text
    END AS geojson,
    p.highway,
    r.pm25, r.no2, r.o3, r.pm10, r.aqi,
    r.pm25_delta, r.no2_delta, r.pm10_delta,
    r.pi95_lo, r.pi95_hi, r.confidence, r.confidence_score,
    r.ood_refused, r.ai_classified, r.engine
  FROM picked p
  LEFT JOIN public.road_aqi_precomputed r ON r.osm_way_id = p.osm_way_id
  ORDER BY p.hw_prio, p.plen DESC;
END;
$function$;
