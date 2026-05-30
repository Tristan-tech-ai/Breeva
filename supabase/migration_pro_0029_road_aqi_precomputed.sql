-- Precompute cache for v2 road AQI (Phase: "no-load" serve).
-- The refresh job (vayu/precompute/refresh_road_aqi.mts) calls the live v2 engine per grid
-- tile and upserts the per-road result here. The serve (road-aqi.ts, behind USE_PRECOMPUTE)
-- then does a fast PK batch-lookup by osm_way_id instead of recomputing CALINE4 + Background
-- + GP + fetching Open-Meteo/WAQI/satellite per request. Values == the live engine (same code
-- path → zero parity drift). Refreshed on a schedule (v2 prior is daily-calibrated → hourly /
-- few-hourly refresh is accuracy-safe).
CREATE TABLE IF NOT EXISTS public.road_aqi_precomputed (
  osm_way_id        bigint PRIMARY KEY,
  region            text,
  aqi               integer,
  pm25              real,
  no2               real,
  o3                real,
  pm10              real,
  pm25_delta        real,
  no2_delta         real,
  pm10_delta        real,
  pi95_lo           real,
  pi95_hi           real,
  confidence        text,        -- high | medium | low | refuse
  confidence_score  real,
  ood_refused       boolean,
  ai_classified     boolean,
  engine            text DEFAULT 'v2',
  computed_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rap_region ON public.road_aqi_precomputed(region);
CREATE INDEX IF NOT EXISTS idx_rap_computed_at ON public.road_aqi_precomputed(computed_at);

COMMENT ON TABLE public.road_aqi_precomputed IS
  'Precomputed v2 road-AQI values (osm_way_id PK). Populated by the scheduled refresh job calling the live engine; served via fast PK lookup behind USE_PRECOMPUTE. Refresh ~hourly (daily-calibrated prior).';
