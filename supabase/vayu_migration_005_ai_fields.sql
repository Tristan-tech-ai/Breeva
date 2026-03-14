-- ============================================
-- VAYU ENGINE — MIGRATION 005: AI Classification Fields
-- Adds Gemini AI micro-classification columns to road_segments
-- ============================================

-- Micro-classification: AI-derived road type for pollution accuracy
-- Values: highway, arterial, collector, local_road, neighborhood_road, alley, gang, pedestrian_only
ALTER TABLE road_segments ADD COLUMN IF NOT EXISTS micro_class VARCHAR(30);

-- AI pollution factor: multiplier on computed pollution delta [0.0 = zero traffic, 2.0 = heavy]
ALTER TABLE road_segments ADD COLUMN IF NOT EXISTS ai_pollution_factor DECIMAL(3,2);

-- Timestamp of last AI classification
ALTER TABLE road_segments ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ;

-- Index for finding unclassified roads efficiently
CREATE INDEX IF NOT EXISTS idx_road_ai_classified ON road_segments (ai_classified_at NULLS FIRST)
  WHERE ai_classified_at IS NULL;
