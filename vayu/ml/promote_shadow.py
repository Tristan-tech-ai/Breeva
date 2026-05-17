"""
Tier 4 Phase 4.2 — Daily shadow-model evaluator + auto-promote/demote gate.

Gate rules:
  - PROMOTE: shadow_mae_7d < active_mae × promote_threshold (default 0.95)
             AND shadow_n_samples >= min_samples (default 200)
             AND shadow_started_at older than 7 days (matured)
  - DEMOTE: shadow_mae_7d > active_mae × demote_threshold (default 1.10)
  - else: keep observing

Run:
    python vayu/ml/promote_shadow.py
    python vayu/ml/promote_shadow.py --dry-run
"""

from __future__ import annotations
import argparse
import logging
import os
import sys

import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('promote_shadow')


def evaluate_and_promote(
    conn,
    model_name: str,
    promote_threshold: float,
    demote_threshold: float,
    min_samples: int,
    dry_run: bool,
) -> str:
    cur = conn.cursor()

    cur.execute(
        """
        SELECT version, (metrics->>'test_mae')::REAL AS mae
        FROM public.ml_model_registry
        WHERE model_name = %s AND active = TRUE
        LIMIT 1
        """,
        (model_name,),
    )
    active = cur.fetchone()
    if not active:
        log.info(f'[{model_name}] no active model; skip')
        return 'no_active'
    active_version, active_mae = active

    cur.execute(
        """
        SELECT version, shadow_mae_7d, shadow_n_samples,
               EXTRACT(EPOCH FROM (NOW() - shadow_started_at)) / 86400 AS age_d
        FROM public.ml_model_registry
        WHERE model_name = %s AND shadow = TRUE
        LIMIT 1
        """,
        (model_name,),
    )
    shadow = cur.fetchone()
    if not shadow:
        log.info(f'[{model_name}] no shadow model; skip')
        return 'no_shadow'
    shadow_version, shadow_mae, shadow_n, age_days = shadow

    log.info(
        f'[{model_name}] active={active_version} mae={active_mae} | '
        f'shadow={shadow_version} mae={shadow_mae} n={shadow_n} age={age_days}d'
    )

    if shadow_mae is None or shadow_n is None or shadow_n < min_samples:
        log.info('  insufficient samples; keep observing')
        return 'insufficient'
    if age_days is None or float(age_days) < 7:
        log.info('  shadow < 7 days old; keep observing')
        return 'not_matured'
    if active_mae is None or active_mae == 0:
        log.info('  active mae missing; cannot compute ratio')
        return 'no_active_mae'

    ratio = float(shadow_mae) / float(active_mae)

    if ratio < promote_threshold:
        if dry_run:
            log.info(f'  [DRY] would PROMOTE {shadow_version} (ratio={ratio:.3f})')
            return 'would_promote'
        cur.execute(
            "UPDATE public.ml_model_registry SET active = FALSE "
            "WHERE model_name = %s AND active = TRUE",
            (model_name,),
        )
        cur.execute(
            "UPDATE public.ml_model_registry "
            "SET active = TRUE, shadow = FALSE, promoted_at = NOW() "
            "WHERE model_name = %s AND version = %s",
            (model_name, shadow_version),
        )
        cur.execute(
            """
            INSERT INTO public.gcn_road_predictions
              (osm_way_id, hour_of_day, pm25_delta_gcn, uncertainty_sigma,
               variance_index, model_version, predicted_at)
            SELECT osm_way_id, hour_of_day, pm25_delta_gcn, uncertainty_sigma,
                   NULL, model_version, computed_at
            FROM public.gcn_road_predictions_shadow
            WHERE model_version = %s
            ON CONFLICT (osm_way_id, hour_of_day) DO UPDATE SET
              pm25_delta_gcn = EXCLUDED.pm25_delta_gcn,
              uncertainty_sigma = EXCLUDED.uncertainty_sigma,
              model_version = EXCLUDED.model_version,
              predicted_at = NOW()
            """,
            (shadow_version,),
        )
        copied = cur.rowcount
        conn.commit()
        log.info(f'  PROMOTED {shadow_version} (ratio={ratio:.3f}); copied {copied} predictions')
        return 'promoted'

    if ratio > demote_threshold:
        if dry_run:
            log.info(f'  [DRY] would DEMOTE {shadow_version} (ratio={ratio:.3f})')
            return 'would_demote'
        cur.execute(
            "UPDATE public.ml_model_registry "
            "SET shadow = FALSE, notes = COALESCE(notes,'') || ' | demoted ratio=' || %s "
            "WHERE model_name = %s AND version = %s",
            (f'{ratio:.3f}', model_name, shadow_version),
        )
        cur.execute(
            "DELETE FROM public.gcn_road_predictions_shadow WHERE model_version = %s",
            (shadow_version,),
        )
        conn.commit()
        log.info(f'  DEMOTED {shadow_version} (ratio={ratio:.3f})')
        return 'demoted'

    log.info(f'  HOLD (ratio={ratio:.3f} in band [{promote_threshold}, {demote_threshold}])')
    return 'hold'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-name', default='gcn_road')
    parser.add_argument('--promote-threshold', type=float, default=0.95)
    parser.add_argument('--demote-threshold', type=float, default=1.10)
    parser.add_argument('--min-samples', type=int, default=200)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    load_dotenv('.env.local')
    pooler = os.environ.get('SUPABASE_POOLER_URL')
    if not pooler:
        log.error('SUPABASE_POOLER_URL missing')
        sys.exit(2)

    with psycopg2.connect(pooler) as conn:
        evaluate_and_promote(
            conn,
            args.model_name,
            args.promote_threshold,
            args.demote_threshold,
            args.min_samples,
            args.dry_run,
        )


if __name__ == '__main__':
    main()
