"""
Tier 4 Phase 4.5 — Continuous training loop / drift monitor.

Daily job. Looks at the last 24 h of (predicted, actual) pairs from
prediction_logs joined with gcn_road_predictions for the active model. If
per-region MAE drifts above a threshold OR PI95 coverage falls outside
[0.90, 0.97], emits a warning row to drift_alerts and (optionally) triggers a
retrain.

Run:
    python vayu/ml/drift_monitor.py
    python vayu/ml/drift_monitor.py --dry-run --window-hours 24
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('drift_monitor')

# Per-region MAE drift thresholds (mug/m3). Region-specific because Bali physics
# differs from Jakarta; Tier-B regions get looser bounds.
REGION_MAE_BUDGET: dict[str, float] = {
    'jakarta':    9.0,
    'bali':       11.0,
    'bandung':    11.0,
    'surabaya':   11.0,
    'medan':      13.0,
    'semarang':   13.0,
    'makassar':   13.0,
    'palembang':  13.0,
    'yogyakarta': 13.0,
    'denpasar':   11.0,
}
DEFAULT_MAE_BUDGET = 14.0


def ensure_alerts_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS public.drift_alerts (
              id BIGSERIAL PRIMARY KEY,
              raised_at TIMESTAMPTZ DEFAULT NOW(),
              region TEXT NOT NULL,
              metric TEXT NOT NULL,
              observed REAL,
              threshold REAL,
              window_hours INT,
              model_version TEXT,
              severity TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
              acknowledged_at TIMESTAMPTZ
            )
            """
        )
    conn.commit()


def compute_region_metrics(conn, window_hours: int) -> list[dict]:
    sql = """
    WITH joined AS (
      SELECT
        pl.region,
        pl.predicted_pm25,
        pl.corrected_pm25,
        pl.ground_truth_pm25,
        g.pm25_delta_gcn,
        g.uncertainty_sigma,
        g.model_version,
        (COALESCE(pl.corrected_pm25, pl.predicted_pm25) + COALESCE(g.pm25_delta_gcn, 0))::REAL AS final_pred
      FROM public.prediction_logs pl
      LEFT JOIN public.gcn_road_predictions g
        ON g.osm_way_id = pl.osm_way_id
       AND g.hour_of_day = EXTRACT(HOUR FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT
      WHERE pl.ground_truth_pm25 IS NOT NULL
        AND pl.predicted_at > NOW() - (%s || ' hours')::INTERVAL
    )
    SELECT
      region,
      MIN(model_version) AS model_version,
      COUNT(*)::INT AS n,
      AVG(ABS(final_pred - ground_truth_pm25))::REAL AS mae,
      (COUNT(*) FILTER (
        WHERE ABS(final_pred - ground_truth_pm25)
            < 1.96 * GREATEST(COALESCE(uncertainty_sigma, 0.5), 0.1)
      )::REAL / NULLIF(COUNT(*), 0))::REAL AS pi95_coverage
    FROM joined
    GROUP BY region
    """
    with conn.cursor() as cur:
        cur.execute(sql, (str(window_hours),))
        rows = cur.fetchall()
    out = []
    for r in rows:
        out.append({
            'region': r[0],
            'model_version': r[1],
            'n': r[2],
            'mae': float(r[3]) if r[3] is not None else None,
            'pi95_coverage': float(r[4]) if r[4] is not None else None,
        })
    return out


def insert_alert(conn, region: str, metric: str, observed: float | None,
                 threshold: float, window_hours: int, model_version: str | None,
                 severity: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.drift_alerts
              (region, metric, observed, threshold, window_hours, model_version, severity)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (region, metric, observed, threshold, window_hours, model_version, severity),
        )
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--window-hours', type=int, default=24)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--min-samples', type=int, default=20)
    args = parser.parse_args()

    load_dotenv('.env.local')
    pooler = os.environ.get('SUPABASE_POOLER_URL')
    if not pooler:
        log.error('SUPABASE_POOLER_URL missing')
        sys.exit(2)

    with psycopg2.connect(pooler) as conn:
        ensure_alerts_table(conn)
        metrics = compute_region_metrics(conn, args.window_hours)
        if not metrics:
            log.info('no labeled predictions in window; skip')
            return

        for m in metrics:
            region = m['region']
            budget = REGION_MAE_BUDGET.get(region, DEFAULT_MAE_BUDGET)
            log.info(
                f"{region:10s} n={m['n']:4d} mae={m['mae']} pi95={m['pi95_coverage']} model={m['model_version']}"
            )
            if m['n'] < args.min_samples:
                continue
            if m['mae'] is not None and m['mae'] > budget:
                msg = f"  ALERT mae {m['mae']:.2f} > budget {budget}"
                log.warning(msg)
                if not args.dry_run:
                    sev = 'critical' if m['mae'] > budget * 1.5 else 'warn'
                    insert_alert(conn, region, 'mae', m['mae'], budget,
                                 args.window_hours, m['model_version'], sev)
            if m['pi95_coverage'] is not None and (
                m['pi95_coverage'] < 0.90 or m['pi95_coverage'] > 0.97
            ):
                msg = f"  ALERT pi95 {m['pi95_coverage']:.3f} outside [0.90, 0.97]"
                log.warning(msg)
                if not args.dry_run:
                    insert_alert(conn, region, 'pi95_coverage', m['pi95_coverage'],
                                 0.95, args.window_hours, m['model_version'], 'warn')


if __name__ == '__main__':
    main()
