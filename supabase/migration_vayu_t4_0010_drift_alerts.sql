-- Playbook §10 + §4.3 — Pre-create drift_alerts table so RLS + indexes are
-- explicit instead of auto-created by drift_monitor.py with default RLS off.

CREATE TABLE IF NOT EXISTS public.drift_alerts (
  id BIGSERIAL PRIMARY KEY,
  raised_at TIMESTAMPTZ DEFAULT NOW(),
  region TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('mae', 'pi95_coverage', 'feature_psi', 'label_count')),
  observed REAL,
  threshold REAL,
  window_hours INT,
  model_version TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_drift_alerts_unack
  ON public.drift_alerts (raised_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drift_alerts_region
  ON public.drift_alerts (region, raised_at DESC);

ALTER TABLE public.drift_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drift_alerts_read ON public.drift_alerts;
CREATE POLICY drift_alerts_read ON public.drift_alerts
  FOR SELECT TO anon, authenticated USING (true);

-- Helper view: unacknowledged alerts last 7 days, ranked by severity
CREATE OR REPLACE VIEW public.v_drift_alerts_unack AS
SELECT
  id, raised_at, region, metric, observed, threshold, window_hours,
  model_version, severity,
  CASE severity WHEN 'critical' THEN 3 WHEN 'warn' THEN 2 ELSE 1 END AS severity_rank
FROM public.drift_alerts
WHERE acknowledged_at IS NULL
  AND raised_at > NOW() - INTERVAL '7 days'
ORDER BY severity_rank DESC, raised_at DESC;

ALTER VIEW public.v_drift_alerts_unack SET (security_invoker = on);
GRANT SELECT ON public.v_drift_alerts_unack TO anon, authenticated;
