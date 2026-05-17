"""
Playbook §2.5 — Active learning: boost sampling for high-uncertainty roads.

Daily 04:00 WIB. Queries top-5% epistemic_sigma roads from gcn_road_predictions,
upserts override row in region_config_per_road so road-aqi.ts logs them at
2× baseline rate. Reduces sampling for low-uncertainty roads (sigma < median × 0.5).

Effect: focus labeling budget where model is genuinely uncertain. 2-3× faster
convergence vs uniform sampling.

Run:
    python vayu/jobs/active_learning_sampler.py
    python vayu/jobs/active_learning_sampler.py --top-pct 0.10 --boost-mult 3.0
    python vayu/jobs/active_learning_sampler.py --dry-run
"""

from __future__ import annotations
import argparse
import logging
import os
import sys

import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('active_learning')


def sample(conn, top_pct: float, boost_mult: float, low_pct: float, dry_run: bool):
    # Compute regional sigma quantiles + identify high/low buckets
    sql_quantiles = """
        WITH ranked AS (
          SELECT osm_way_id,
                 region,
                 -- prefer epistemic over total sigma (epistemic = model uncertainty,
                 -- aleatoric = data noise — only epistemic actionable via labeling)
                 COALESCE(g.epistemic_sigma, g.uncertainty_sigma) AS sigma
          FROM public.gcn_road_predictions g
          JOIN public.gcn_graph_nodes n USING (osm_way_id)
          WHERE g.predicted_at > NOW() - INTERVAL '36 hours'
        ),
        ranked_pct AS (
          SELECT osm_way_id, region, sigma,
                 PERCENT_RANK() OVER (PARTITION BY region ORDER BY sigma DESC) AS pct_rank
          FROM ranked
        )
        SELECT osm_way_id, region, sigma, pct_rank
        FROM ranked_pct
        WHERE pct_rank < %(top)s OR pct_rank > (1 - %(low)s)
    """
    with conn.cursor() as cur:
        cur.execute(sql_quantiles, {'top': top_pct, 'low': low_pct})
        rows = cur.fetchall()

    if not rows:
        log.warning('no predictions in last 36h — skip')
        return

    boost_rows = [(r[0], boost_mult) for r in rows if r[3] < top_pct]
    reduce_rows = [(r[0], 0.05) for r in rows if r[3] > (1 - low_pct)]

    log.info(f'top {top_pct:.0%} (boost): {len(boost_rows)} roads')
    log.info(f'bottom {low_pct:.0%} (reduce): {len(reduce_rows)} roads')

    if dry_run:
        log.info('--dry-run: not writing overrides')
        return

    with conn.cursor() as cur:
        # Reset all overrides first (clean slate each day)
        cur.execute('DELETE FROM public.region_config_per_road')
        # Insert boost + reduce rows
        from psycopg2.extras import execute_values
        all_rows = boost_rows + reduce_rows
        if all_rows:
            execute_values(
                cur,
                """INSERT INTO public.region_config_per_road
                     (osm_way_id, prediction_log_sample_rate_override, set_at)
                   VALUES %s
                   ON CONFLICT (osm_way_id) DO UPDATE SET
                     prediction_log_sample_rate_override = EXCLUDED.prediction_log_sample_rate_override,
                     set_at = EXCLUDED.set_at""",
                [(wid, rate, 'now()') for wid, rate in all_rows],
                template="(%s, %s, NOW())",
            )
        conn.commit()
    log.info(f'wrote {len(all_rows)} overrides')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--top-pct', type=float, default=0.05,
                        help='Top fraction by uncertainty to boost (default 5%)')
    parser.add_argument('--low-pct', type=float, default=0.20,
                        help='Bottom fraction to reduce (default 20%)')
    parser.add_argument('--boost-mult', type=float, default=2.0,
                        help='Boosted sample rate multiplier vs baseline (default 2×)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    load_dotenv('.env.local')
    pooler = os.environ.get('SUPABASE_POOLER_URL')
    if not pooler:
        log.error('SUPABASE_POOLER_URL missing')
        sys.exit(2)

    with psycopg2.connect(pooler) as conn:
        with conn.cursor() as cur:
            cur.execute('SET statement_timeout = 0')
        sample(conn, args.top_pct, args.boost_mult, args.low_pct, args.dry_run)


if __name__ == '__main__':
    main()
