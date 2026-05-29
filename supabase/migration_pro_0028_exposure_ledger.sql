-- Migration pro_0028 — Layer 3 Exposure Risk Calculator ledger (2026-05-29)
--
-- Persists computed inhaled-dose results (the /paparan calculator + walk completion).
-- Dose methodology = src/lib/exposure.ts: D = Σ Cᵢ·V(age,mode)·α(mode)·IF(mode)·Δtᵢ
-- (EPA breathing rates + penetration + intake fraction; cigarette 660µg Pope 2009; WHO 2021 AQG).
--
-- Design (per plan §22): FK → public.users(id) (= auth.uid()); RLS own-rows; LOGGED-IN ONLY
-- (no anonymous insert policy — the /paparan page still works for anon, it just won't persist).

CREATE TABLE IF NOT EXISTS public.exposure_ledger (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  walk_id               UUID REFERENCES public.walks(id) ON DELETE SET NULL,
  source                TEXT NOT NULL DEFAULT 'paparan'          -- 'paparan' | 'walk'
                          CHECK (source IN ('paparan', 'walk')),
  label                 TEXT,
  -- user profile snapshot at calculation time
  user_age_bucket       TEXT CHECK (user_age_bucket IN ('child', 'adult', 'elderly')),
  user_mode             TEXT,
  user_health_sensitive BOOLEAN DEFAULT false,
  -- inputs
  duration_seconds      INTEGER NOT NULL,
  segment_count         INTEGER,
  pm25_mean_ugm3        NUMERIC(7,2),
  pm25_peak_ugm3        NUMERIC(7,2),
  breathing_rate_m3min  NUMERIC(6,4),
  penetration           NUMERIC(4,2),
  intake_fraction       NUMERIC(4,2),
  -- outputs
  dose_ug               NUMERIC(10,2) NOT NULL,
  who_24h_ratio         NUMERIC(7,3),
  cigarette_equiv       NUMERIC(7,3),
  risk_level            TEXT CHECK (risk_level IN ('low', 'moderate', 'high', 'very_high')),
  calculation_method    TEXT DEFAULT 'haber_epa_v1',
  computed_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exposure_ledger_user_idx
  ON public.exposure_ledger (user_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS exposure_ledger_walk_idx
  ON public.exposure_ledger (walk_id) WHERE walk_id IS NOT NULL;

ALTER TABLE public.exposure_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own exposure" ON public.exposure_ledger;
CREATE POLICY "Users read own exposure" ON public.exposure_ledger
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own exposure" ON public.exposure_ledger;
CREATE POLICY "Users insert own exposure" ON public.exposure_ledger
  FOR INSERT WITH CHECK (auth.uid() = user_id);
