-- ============================================================================
-- Migration 010 — Supabase-specific audit fixes
-- ============================================================================
-- Identifikasi: 2026-05-15 setelah setup Supabase MCP server.
-- Tiga critical issue ditemukan saat audit folder supabase/:
--
--   (1) RLS HOLE: vayu_contributions FOR INSERT WITH CHECK (true) di
--       vayu_migration.sql:200 → siapa saja dengan anon key bisa insert.
--       Fix: scope ke service_role only (sama dengan tabel sister di file
--       yang sama line 182, 188, 194, 206).
--
--   (2) BROKEN FUNCTION: upgrade_merchant_sponsor di
--       migration_008_merchant_ownership.sql:50-99 mereferensi kolom
--       users.eco_points (tidak exist; nama benar: ecopoints_balance) dan
--       tabel eco_points_transactions (tidak exist; nama benar:
--       points_transactions). Dipanggil dari MerchantDashboardPage.tsx:253
--       jadi crash setiap upgrade attempt.
--
--   (3) MISSING RLS: tabel `merchants` tidak ada policy SELECT eksplisit;
--       padahal RLS belum di-ENABLE pada tabel ini (schema.sql:278-279
--       komentar "Public read access tables (no RLS needed)"). Untuk safety
--       defense-in-depth, enable RLS + public read policy.
--
-- HOW TO APPLY:
--   Supabase Dashboard → SQL Editor → New query → paste → Run.
--   Idempotent (safe to re-run).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Fix RLS hole pada vayu_contributions
-- ─────────────────────────────────────────────────────────────────────────
-- Policy lama: WITH CHECK (true) — anon bisa INSERT.
-- Endpoint api/vayu/contribute.ts memakai service role key untuk insert via
-- REST API, jadi policy harus scope ke service_role.
DROP POLICY IF EXISTS "Service write contributions" ON vayu_contributions;

CREATE POLICY "Service write contributions" ON vayu_contributions
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Optional: allow public SELECT untuk transparency (data sudah anonymized
-- by design — session_id BUKAN user_id). Comment out kalau prefer private.
DROP POLICY IF EXISTS "Public read contributions" ON vayu_contributions;
CREATE POLICY "Public read contributions" ON vayu_contributions
  FOR SELECT USING (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Fix broken upgrade_merchant_sponsor function
-- ─────────────────────────────────────────────────────────────────────────
-- Kolom & tabel yang salah disebut di migration 008 sekarang dikoreksi.
CREATE OR REPLACE FUNCTION upgrade_merchant_sponsor(
  p_merchant_id UUID,
  p_user_id UUID,
  p_tier VARCHAR(20),
  p_cost INTEGER
) RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_current_points INTEGER;
  v_boost INTEGER;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND owner_id = p_user_id) THEN
    RETURN QUERY SELECT false, 'You do not own this merchant'::TEXT;
    RETURN;
  END IF;

  -- Check points (FIX: ecopoints_balance, BUKAN eco_points)
  SELECT ecopoints_balance INTO v_current_points FROM users WHERE id = p_user_id;
  IF v_current_points < p_cost THEN
    RETURN QUERY SELECT false, 'Insufficient EcoPoints'::TEXT;
    RETURN;
  END IF;

  -- Map tier to boost
  v_boost := CASE p_tier
    WHEN 'basic' THEN 1
    WHEN 'premium' THEN 2
    WHEN 'featured' THEN 3
    ELSE 0
  END;

  -- Update merchant
  UPDATE merchants SET
    sponsor_tier = p_tier,
    sponsor_expires_at = NOW() + INTERVAL '30 days',
    priority_boost = v_boost,
    updated_at = NOW()
  WHERE id = p_merchant_id;

  -- Deduct points via canonical helper to keep transaction log consistent
  -- (FIX: add_ecopoints handles points_transactions insert correctly; was
  -- referring to non-existent eco_points_transactions table)
  PERFORM add_ecopoints(
    p_user_id,
    -p_cost,
    'redemption',
    'Sponsor upgrade to ' || p_tier || ' for merchant',
    'merchant_sponsor',
    p_merchant_id
  );

  RETURN QUERY SELECT true, ('Upgraded to ' || p_tier)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS defense-in-depth pada merchants (was: "Public read access tables")
-- ─────────────────────────────────────────────────────────────────────────
-- Sebelumnya merchants tidak ENABLE RLS sama sekali. Itu OK kalau Data API
-- settings tidak expose anon write — tapi defense-in-depth tetap penting.
-- Public read + owner-only write.
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active merchants" ON merchants;
CREATE POLICY "Anyone can view active merchants" ON merchants
  FOR SELECT USING (is_active = true OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owner can update own merchant" ON merchants;
CREATE POLICY "Owner can update own merchant" ON merchants
  FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Authenticated users can register merchant" ON merchants;
CREATE POLICY "Authenticated users can register merchant" ON merchants
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owner can delete own merchant" ON merchants;
CREATE POLICY "Owner can delete own merchant" ON merchants
  FOR DELETE USING (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Improve onboarding_completed backfill (was Migration 009)
-- ─────────────────────────────────────────────────────────────────────────
-- Migration 009 backfilled berdasarkan total_walks > 0 OR ecopoints_balance > 0.
-- Edge case: user yang sudah onboard tapi belum walk DAN sudah klik bonus
-- onboarding tapi balance dikurangi (mis. via redeem) akan re-onboard.
-- Tambah kondisi: cek points_transactions untuk 'onboarding_bonus' type.
UPDATE users
SET onboarding_completed = TRUE
WHERE onboarding_completed = FALSE
  AND EXISTS (
    SELECT 1 FROM points_transactions pt
    WHERE pt.user_id = users.id
      AND pt.transaction_type IN ('onboarding_bonus', 'walk', 'achievement')
  );

COMMIT;

-- ============================================================================
-- VERIFY (jalankan setelah migration apply)
-- ============================================================================
-- 1. RLS vayu_contributions hardened?
--    SELECT policyname, with_check FROM pg_policies
--    WHERE tablename = 'vayu_contributions' AND cmd = 'INSERT';
--    Expected: 1 row, with_check = '(auth.role() = ''service_role''::text)'
--
-- 2. upgrade_merchant_sponsor returns correctly?
--    SELECT * FROM upgrade_merchant_sponsor(
--      '00000000-0000-0000-0000-000000000000'::uuid,
--      '00000000-0000-0000-0000-000000000000'::uuid,
--      'basic', 500
--    );
--    Expected: success=false, message='You do not own this merchant'
--    (BUKAN error 'column "eco_points" does not exist')
--
-- 3. merchants RLS aktif?
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'merchants';
--    Expected: t (true)
--
-- 4. Onboarding backfill mengena lebih banyak user?
--    SELECT COUNT(*) FROM users WHERE onboarding_completed = TRUE;
--    Cek vs sebelum migration (kalau Tristan punya snapshot).
-- ============================================================================
