-- perf_0001: road_aqi_precomputed bloats from the precompute refresh, which
-- upserts all ~1.4M rows each run (ON CONFLICT DO UPDATE -> ~1.4M dead tuples).
-- The DEFAULT throttled autovacuum could not keep up: the table reached 59.5%
-- dead tuples / 2.5 GB and road-aqi reads (find_roads_*_in_bbox) slowed to 6-40s.
-- Make autovacuum aggressive + unthrottled on THIS table so the churn is cleaned
-- quickly and reads stay fast. Paired with reducing the precompute refresh from
-- hourly to every 6h (Windows task BreevaRoadAQIPrecompute). Applied 2026-05-31.
ALTER TABLE public.road_aqi_precomputed SET (
  autovacuum_vacuum_scale_factor  = 0.1,    -- vacuum at 10% dead (was 20% default)
  autovacuum_analyze_scale_factor = 0.1,
  autovacuum_vacuum_cost_delay    = 0,      -- unthrottled (was ~2ms throttle)
  autovacuum_vacuum_cost_limit    = 6000
);
