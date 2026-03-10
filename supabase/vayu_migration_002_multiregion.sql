-- ============================================
-- VAYU ENGINE — MIGRATION 002: Multi-Region Support
-- Expand scope: Bali-only → Bali + Jawa + Sulawesi
--
-- ⚠️ SAFE TO RUN: ALTER COLUMN hanya mengubah default, tidak menghapus data.
--    Existing rows dengan region='bali' tetap aman.
-- ============================================

-- road_segments: drop DEFAULT 'bali', set NOT NULL
ALTER TABLE road_segments ALTER COLUMN region SET NOT NULL;
ALTER TABLE road_segments ALTER COLUMN region DROP DEFAULT;

-- ghost_paths: drop DEFAULT 'bali', set NOT NULL
ALTER TABLE ghost_paths ALTER COLUMN region SET NOT NULL;
ALTER TABLE ghost_paths ALTER COLUMN region DROP DEFAULT;
