-- Tier 4 Phase 4.3 — Uncertainty decomposition columns: epistemic + aleatoric.
-- Single-model GraphSAGE only produces aleatoric (data noise). Deep ensemble
-- contributes epistemic (model uncertainty) via variance across members.
-- σ_total = sqrt(σ_aleatoric² + σ_epistemic²).

ALTER TABLE public.gcn_road_predictions
  ADD COLUMN IF NOT EXISTS epistemic_sigma REAL,
  ADD COLUMN IF NOT EXISTS aleatoric_sigma REAL,
  ADD COLUMN IF NOT EXISTS ensemble_size SMALLINT DEFAULT 1;

ALTER TABLE public.gcn_road_predictions_shadow
  ADD COLUMN IF NOT EXISTS epistemic_sigma REAL,
  ADD COLUMN IF NOT EXISTS aleatoric_sigma REAL,
  ADD COLUMN IF NOT EXISTS ensemble_size SMALLINT DEFAULT 1;

ALTER TABLE public.prediction_logs
  ADD COLUMN IF NOT EXISTS gcn_epistemic_sigma REAL,
  ADD COLUMN IF NOT EXISTS gcn_aleatoric_sigma REAL,
  ADD COLUMN IF NOT EXISTS within_pi95 BOOLEAN;
