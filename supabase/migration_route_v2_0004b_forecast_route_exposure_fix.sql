-- TIER 2 M2 fix (2026-05-29) — forecast_route_exposure fallback was dimensionally wrong.
--
-- BUG: the no-LSTM-forecast fallback computed step_pm25 = (traffic_base_estimate / 100) * 25.
-- traffic_base_estimate is a vehicle COUNT (max 8800 in our graph) → (8800/100)*25 = 2200 µg/m³
-- → AQI capped at 500. Any route passing a busy road segment showed "AQI naik ke 500" — even in
-- clean regions (the reported Bali AQI-38 case). Traffic count is NOT a PM2.5 scale.
--
-- FIX: sane urban background (~18 µg/m³) × static diurnal + a BOUNDED road increment (≤ 18 µg/m³
-- via LEAST(18, traffic/300)). Verified: a Bali walking polyline now forecasts max AQI ~80 (was 500).
--
-- Applied to the live DB via Supabase MCP migration `fix_forecast_route_exposure_fallback_500`
-- on 2026-05-29; this file is the repo record (supersedes the fallback in 0004).

CREATE OR REPLACE FUNCTION public.forecast_route_exposure(
  polyline jsonb,
  start_at timestamptz DEFAULT NOW()
)
RETURNS TABLE (
  segment_index    int,
  arrival_offset_s double precision,
  arrival_hour     int,
  segment_pm25     double precision,
  segment_aqi      int,
  segment_length_m double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  i int;
  n_points int;
  pt0 geometry;
  pt1 geometry;
  cum_dist double precision := 0;
  base_hour int;
  step_pm25 double precision;
  step_factor double precision;
  step_aqi  int;
  step_len  double precision;
  step_traffic double precision;
  MAX_SEGMENTS constant int := 500;
BEGIN
  n_points := jsonb_array_length(polyline);
  IF polyline IS NULL OR n_points < 2 THEN
    RETURN;
  END IF;

  base_hour := EXTRACT(hour FROM start_at AT TIME ZONE 'Asia/Jakarta')::int;

  FOR i IN 0 .. LEAST(n_points - 2, MAX_SEGMENTS - 1) LOOP
    pt0 := ST_SetSRID(ST_MakePoint(
      (polyline -> i ->> 0)::double precision,
      (polyline -> i ->> 1)::double precision
    ), 4326);
    pt1 := ST_SetSRID(ST_MakePoint(
      (polyline -> (i + 1) ->> 0)::double precision,
      (polyline -> (i + 1) ->> 1)::double precision
    ), 4326);

    step_len := ST_Distance(pt0::geography, pt1::geography);
    cum_dist := cum_dist + step_len;
    arrival_offset_s := cum_dist * 0.72;
    arrival_hour := (base_hour + (arrival_offset_s / 3600)::int) % 24;

    SELECT f.predicted_pm25 INTO step_pm25
    FROM public.aqi_forecast f
    WHERE f.forecast_hour = arrival_hour
      AND f.cell_id = ST_GeoHash(ST_Centroid(ST_MakeLine(pt0, pt1)), 6)
      AND f.forecast_made_at > NOW() - INTERVAL '6 hours'
    ORDER BY f.forecast_made_at DESC
    LIMIT 1;

    -- Fallback: sane urban background x diurnal + a BOUNDED road increment (see header).
    IF step_pm25 IS NULL THEN
      SELECT COALESCE(rs.traffic_base_estimate, 100)
      INTO step_traffic
      FROM public.road_segments rs
      WHERE rs.geom IS NOT NULL
      ORDER BY rs.geom <-> ST_Centroid(ST_MakeLine(pt0, pt1))
      LIMIT 1;

      step_factor := CASE
        WHEN arrival_hour BETWEEN 7  AND 9  THEN 1.45
        WHEN arrival_hour BETWEEN 16 AND 19 THEN 1.40
        WHEN arrival_hour BETWEEN 22 AND 23 THEN 1.10
        WHEN arrival_hour BETWEEN 0  AND 4  THEN 0.75
        WHEN arrival_hour BETWEEN 12 AND 14 THEN 1.15
        ELSE 1.0
      END;

      step_pm25 := 18.0 * step_factor + LEAST(18.0, COALESCE(step_traffic, 100) / 300.0);
    END IF;

    step_aqi := CASE
      WHEN step_pm25 <= 12   THEN GREATEST(0, ROUND(step_pm25 * 50 / 12)::int)
      WHEN step_pm25 <= 35.4 THEN ROUND(((step_pm25 - 12) / (35.4 - 12)) * 50 + 51)::int
      WHEN step_pm25 <= 55.4 THEN ROUND(((step_pm25 - 35.4) / (55.4 - 35.4)) * 50 + 101)::int
      WHEN step_pm25 <= 150.4 THEN ROUND(((step_pm25 - 55.4) / (150.4 - 55.4)) * 50 + 151)::int
      WHEN step_pm25 <= 250.4 THEN ROUND(((step_pm25 - 150.4) / (250.4 - 150.4)) * 100 + 201)::int
      ELSE LEAST(500, ROUND(((step_pm25 - 250.4) / (350 - 250.4)) * 100 + 301)::int)
    END;

    segment_index    := i;
    segment_pm25     := round(step_pm25::numeric, 2);
    segment_aqi      := step_aqi;
    segment_length_m := round(step_len::numeric, 2);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forecast_route_exposure TO anon, authenticated, service_role;
