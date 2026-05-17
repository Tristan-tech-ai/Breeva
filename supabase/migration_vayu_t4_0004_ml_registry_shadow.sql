-- Tier 4 Phase 4.2 — Shadow deployment columns on ml_model_registry.
-- Enables champion/challenger pattern: new models start as shadow, evaluated
-- against active for 7 days, auto-promoted/demoted by vayu/ml/promote_shadow.py.

ALTER TABLE public.ml_model_registry
  ADD COLUMN IF NOT EXISTS shadow BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shadow_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shadow_mae_7d REAL,
  ADD COLUMN IF NOT EXISTS shadow_mae_30d REAL,
  ADD COLUMN IF NOT EXISTS shadow_pi95_coverage REAL,
  ADD COLUMN IF NOT EXISTS shadow_n_samples INT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_ml_model_registry_active_shadow
  ON public.ml_model_registry(model_name, active, shadow)
  WHERE active = TRUE OR shadow = TRUE;

-- At most one active, at most one shadow per (model_name, region)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_per_model_region
  ON public.ml_model_registry(model_name, COALESCE(region, ''))
  WHERE active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_per_model_region
  ON public.ml_model_registry(model_name, COALESCE(region, ''))
  WHERE shadow = TRUE;
