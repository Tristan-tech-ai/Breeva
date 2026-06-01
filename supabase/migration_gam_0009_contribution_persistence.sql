-- gam_0009: Contribution persistence — give every contribution a real DB home + a
-- validation state. Previously only 'hazard' reached air_quality_reports; the POI
-- types (missing_place / eco_merchant / green_space) lived ONLY in localStorage.
--
-- Light + idempotent: constant-default ADD COLUMNs (no table rewrite), one new table,
-- guarded CHECK constraints (gam_0001 idiom), additive indexes. ALL writes happen via
-- the service-role endpoint api/contributions/submit.ts — there is deliberately NO
-- client INSERT/UPDATE policy, so status/points can't be self-minted.

-- ============================================================
-- 1. air_quality_reports: validation state + source tag
-- ============================================================
ALTER TABLE public.air_quality_reports
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS ai_notes      text,
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'report';  -- 'report' (hero) | 'calibration' (walk rating)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aqr_status_chk') THEN
    ALTER TABLE public.air_quality_reports
      ADD CONSTRAINT aqr_status_chk CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aqr_user_created
  ON public.air_quality_reports (user_id, created_at DESC);

-- ============================================================
-- 2. place_contributions: POI suggestions (service-role writes only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.place_contributions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  name          text NOT NULL,
  category      text,
  description   text,
  lat           double precision,
  lng           double precision,
  photo_url     text,
  status        text NOT NULL DEFAULT 'pending',
  region_code   text REFERENCES public.regions(code),
  ai_confidence numeric(3,2),
  ai_notes      text,
  validated_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_contrib_type_chk') THEN
    ALTER TABLE public.place_contributions
      ADD CONSTRAINT place_contrib_type_chk CHECK (type IN ('missing_place','eco_merchant','green_space'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_contrib_status_chk') THEN
    ALTER TABLE public.place_contributions
      ADD CONSTRAINT place_contrib_status_chk CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_place_contrib_user_created ON public.place_contributions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_contrib_status       ON public.place_contributions (status);
CREATE INDEX IF NOT EXISTS idx_place_contrib_region       ON public.place_contributions (region_code);

ALTER TABLE public.place_contributions ENABLE ROW LEVEL SECURITY;
-- Owner sees any of their rows (any status) for the History page; everyone sees approved
-- suggestions. Inserts/updates are server-role only (no policy → RLS denies client writes).
DROP POLICY IF EXISTS place_contributions_read ON public.place_contributions;
CREATE POLICY place_contributions_read ON public.place_contributions
  FOR SELECT USING (auth.uid() = user_id OR status = 'approved');
