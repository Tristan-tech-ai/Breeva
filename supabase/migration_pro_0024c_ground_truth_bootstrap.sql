-- Tier 3 Phase 3.0b — Ground Truth Bootstrap
-- Adds ground_truth_* columns to prediction_logs (if missing) + station_snapshots
-- table + attach_station_ground_truth() that joins nearby (≤2 km, ≤2 h) snapshots
-- to prediction_logs rows for supervised GraphSAGE labels.

DO $$ BEGIN
  ALTER TABLE public.prediction_logs ADD COLUMN ground_truth_pm25 REAL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prediction_logs ADD COLUMN ground_truth_source TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prediction_logs ADD COLUMN ground_truth_distance_km REAL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prediction_logs ADD COLUMN ground_truth_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS prediction_logs_truth_idx
  ON public.prediction_logs (ground_truth_pm25)
  WHERE ground_truth_pm25 IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.station_snapshots (
  id BIGSERIAL PRIMARY KEY,
  station_uid TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('waqi','iqair','openaq')),
  region TEXT NOT NULL,
  loc GEOMETRY(Point, 4326) NOT NULL,
  pm25 REAL,
  measured_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (station_uid, source, measured_at)
);
CREATE INDEX IF NOT EXISTS station_snap_loc_gix ON public.station_snapshots USING GIST (loc);
CREATE INDEX IF NOT EXISTS station_snap_measured_idx ON public.station_snapshots (measured_at DESC);
CREATE INDEX IF NOT EXISTS station_snap_region_idx ON public.station_snapshots (region);

CREATE OR REPLACE FUNCTION public.attach_station_ground_truth(
  p_radius_km REAL DEFAULT 2.0,
  p_window_hours INT DEFAULT 2
) RETURNS TABLE(updated_rows INT)
LANGUAGE plpgsql AS $$
DECLARE v_updated INT;
BEGIN
  WITH cands AS (
    SELECT pl.id AS pl_id, ss.pm25, ss.source,
           ST_Distance(ST_Centroid(rs.geom)::GEOGRAPHY, ss.loc::GEOGRAPHY) / 1000.0 AS dist_km,
           ss.measured_at,
           ROW_NUMBER() OVER (PARTITION BY pl.id
             ORDER BY ST_Distance(ST_Centroid(rs.geom)::GEOGRAPHY, ss.loc::GEOGRAPHY)) AS rn
    FROM public.prediction_logs pl
    JOIN public.road_segments rs USING (osm_way_id)
    JOIN public.station_snapshots ss ON ss.region = rs.region
      AND ABS(EXTRACT(EPOCH FROM (ss.measured_at - pl.predicted_at))) < p_window_hours * 3600
      AND ST_DWithin(ST_Centroid(rs.geom)::GEOGRAPHY, ss.loc::GEOGRAPHY, p_radius_km * 1000.0)
    WHERE pl.ground_truth_pm25 IS NULL AND ss.pm25 IS NOT NULL
  )
  UPDATE public.prediction_logs pl
  SET ground_truth_pm25 = c.pm25,
      ground_truth_source = c.source,
      ground_truth_distance_km = c.dist_km,
      ground_truth_at = c.measured_at
  FROM cands c WHERE c.pl_id = pl.id AND c.rn = 1;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN QUERY SELECT v_updated;
END;
$$;
