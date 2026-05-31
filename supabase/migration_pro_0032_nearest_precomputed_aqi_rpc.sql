-- Nearest precomputed v2 AQI for a point (KNN on road_aqi_precomputed via GIST <->).
-- Powers the point/headline AQI (api/vayu/aqi.ts::computeV2) so it serves the calibrated v2
-- engine — the SAME values as the road map — instead of the v1 Gaussian compute. The caller
-- validates dist_m (≤ p_max_m); on a miss (OOD / no nearby coverage) the endpoint falls back
-- to the v1 Gaussian compute. Bbox is sized by p_max_m so far-away rows never match.
CREATE OR REPLACE FUNCTION public.nearest_precomputed_aqi(
  p_lat double precision, p_lon double precision, p_max_m double precision DEFAULT 1500)
RETURNS TABLE(
  pm25 real, no2 real, o3 real, pm10 real, aqi integer,
  confidence text, confidence_score real, region text,
  computed_at timestamptz, dist_m double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT r.pm25, r.no2, r.o3, r.pm10, r.aqi,
         r.confidence, r.confidence_score, r.region, r.computed_at,
         ST_Distance(r.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) AS dist_m
  FROM public.road_aqi_precomputed r
  WHERE r.geom && ST_Expand(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geometry,
                            p_max_m / 111000.0)
    AND r.pm25 IS NOT NULL
  ORDER BY r.geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geometry
  LIMIT 1;
$function$;
