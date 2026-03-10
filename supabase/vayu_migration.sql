-- ============================================
-- VAYU ENGINE — DATABASE MIGRATION
-- Run AFTER existing breeva schema (schema.sql)
-- 
-- ⚠️ SAFE TO RUN: Semua menggunakan IF NOT EXISTS / CREATE OR REPLACE
--    Data existing (users, walks, merchants, rewards, dll.) TIDAK tersentuh.
-- ============================================

-- Enable PostGIS (jika belum)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- V1. AQI GRID (UPSERT SNAPSHOT)
-- ============================================
CREATE TABLE IF NOT EXISTS aqi_grid (
    id BIGSERIAL PRIMARY KEY,
    geom GEOMETRY(Point, 4326) NOT NULL,
    tile_id VARCHAR(20) NOT NULL,
    aqi INTEGER,
    pm25 DECIMAL(6,2),
    pm10 DECIMAL(6,2),
    no2 DECIMAL(6,2),
    co DECIMAL(6,2),
    o3 DECIMAL(6,2),
    confidence DECIMAL(3,2),
    layer_source SMALLINT DEFAULT 0,        -- 0=Open-Meteo, 1=CALINE3-simplified(ModeA), 2=CALINE3-full(ModeB), 3=ML, 4=crowdsource
    hit_count INTEGER DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    UNIQUE (tile_id)
);

CREATE INDEX IF NOT EXISTS idx_aqi_grid_geom ON aqi_grid USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_aqi_grid_tile ON aqi_grid (tile_id);
CREATE INDEX IF NOT EXISTS idx_aqi_grid_hotspot ON aqi_grid (hit_count DESC);
CREATE INDEX IF NOT EXISTS idx_aqi_grid_valid ON aqi_grid (valid_until);

-- ============================================
-- V2. ROAD SEGMENTS (CACHED OSM DATA)
-- ============================================
CREATE TABLE IF NOT EXISTS road_segments (
    id BIGSERIAL PRIMARY KEY,
    osm_way_id BIGINT NOT NULL UNIQUE,
    geom GEOMETRY(LineString, 4326) NOT NULL,
    highway VARCHAR(30),                     -- motorway, primary, secondary, residential, etc.
    lanes SMALLINT,
    width DECIMAL(5,2),
    surface VARCHAR(30),
    maxspeed SMALLINT,
    name VARCHAR(255),
    landuse_proxy VARCHAR(30),               -- nearest landuse: forest, industrial, commercial, etc.
    canyon_ratio DECIMAL(4,2),               -- building_height / road_width
    elevation_avg DECIMAL(7,2),
    traffic_base_estimate INTEGER,           -- OSM heuristic baseline vehicles/hour
    traffic_calibration_factor DECIMAL(4,2) DEFAULT 1.0,  -- dari TomTom sampling
    region VARCHAR(50) NOT NULL,            -- 'bali', 'jakarta', 'bandung', 'surabaya', etc.
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_road_geom ON road_segments USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_road_osm ON road_segments (osm_way_id);
CREATE INDEX IF NOT EXISTS idx_road_region ON road_segments (region);

-- ============================================
-- V3. GHOST PATHS
-- ============================================
CREATE TABLE IF NOT EXISTS ghost_paths (
    id BIGSERIAL PRIMARY KEY,
    geom GEOMETRY(LineString, 4326),
    geohash_trail TEXT[],                    -- Array of geohash level 9 points
    contributor_count INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    avg_aqi DECIMAL(5,2),
    region VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_confirmed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghost_geom ON ghost_paths USING GIST (geom);

-- ============================================
-- V4. CROWDSOURCE CONTRIBUTIONS (PASSIVE TRACES)
-- ============================================
CREATE TABLE IF NOT EXISTS vayu_contributions (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL,                -- Anonymous session, NOT user ID
    osm_way_id BIGINT,
    speed_kmh DECIMAL(5,1),
    vehicle_type VARCHAR(30),
    is_off_road BOOLEAN DEFAULT FALSE,
    off_road_geohash VARCHAR(15),            -- Geohash level 9, only if off-road
    contributed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contrib_way ON vayu_contributions (osm_way_id);
CREATE INDEX IF NOT EXISTS idx_contrib_time ON vayu_contributions (contributed_at);

-- ============================================
-- V4.1 DATA RETENTION — PURGE FUNCTIONS (UU PDP Compliance)
-- ============================================

-- Function: Purge expired contributions (>90 hari)
CREATE OR REPLACE FUNCTION purge_old_contributions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM vayu_contributions
  WHERE contributed_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Purge stale aqi_grid tiles (>24 jam tanpa hit = tile mati)
CREATE OR REPLACE FUNCTION purge_dead_tiles()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM aqi_grid
  WHERE valid_until < NOW() - INTERVAL '24 hours'
    AND hit_count < 3;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Jika pg_cron tersedia di Supabase (Pro plan), aktifkan:
-- SELECT cron.schedule('purge-contributions', '0 3 * * *', 'SELECT purge_old_contributions()');
-- SELECT cron.schedule('purge-dead-tiles', '0 4 * * 0', 'SELECT purge_dead_tiles()');
-- Jika tidak tersedia (Free plan), purge dipanggil via GitHub Actions workflow.

-- ============================================
-- V5. TRAFFIC CALIBRATION LOG
-- ============================================
CREATE TABLE IF NOT EXISTS traffic_calibration (
    id BIGSERIAL PRIMARY KEY,
    road_class VARCHAR(30) NOT NULL,         -- motorway, primary, secondary, etc.
    hour_of_day SMALLINT NOT NULL,           -- 0-23
    day_of_week SMALLINT NOT NULL,           -- 0=Sunday, 6=Saturday
    tomtom_avg_speed DECIMAL(5,1),
    tomtom_free_flow_speed DECIMAL(5,1),
    congestion_level DECIMAL(3,2),           -- 0.0-1.0
    correction_factor DECIMAL(4,2),          -- multiply OSM heuristic by this
    sample_count INTEGER DEFAULT 1,
    calibrated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (road_class, hour_of_day, day_of_week)
);

-- ============================================
-- RLS (Row Level Security) — public read, service-role write
-- ============================================
ALTER TABLE aqi_grid ENABLE ROW LEVEL SECURITY;
ALTER TABLE road_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghost_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE vayu_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE traffic_calibration ENABLE ROW LEVEL SECURITY;

-- Public read (anyone can read AQI data)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read aqi_grid') THEN
    CREATE POLICY "Public read aqi_grid" ON aqi_grid FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read road_segments') THEN
    CREATE POLICY "Public read road_segments" ON road_segments FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read ghost_paths') THEN
    CREATE POLICY "Public read ghost_paths" ON ghost_paths FOR SELECT USING (true);
  END IF;
END $$;

-- Service role write (only backend can write)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service write aqi_grid') THEN
    CREATE POLICY "Service write aqi_grid" ON aqi_grid FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service write road_segments') THEN
    CREATE POLICY "Service write road_segments" ON road_segments FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service write ghost_paths') THEN
    CREATE POLICY "Service write ghost_paths" ON ghost_paths FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service write contributions') THEN
    CREATE POLICY "Service write contributions" ON vayu_contributions FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service write calibration') THEN
    CREATE POLICY "Service write calibration" ON traffic_calibration FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================
-- DONE! Verifikasi dengan:
--   SELECT PostGIS_version();
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%aqi%' OR tablename LIKE '%road%' OR tablename LIKE '%ghost%' OR tablename LIKE '%vayu%' OR tablename LIKE '%traffic_calibration%';
-- ============================================
