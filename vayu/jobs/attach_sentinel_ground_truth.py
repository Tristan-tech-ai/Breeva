"""
Playbook §2.2 Phase A.4 — Backfill prediction_logs.ground_truth_pm25 from
Sentinel-5P proxy data.

Spatial join: road centroid → nearest aqi_grid_sentinel cell within 5 km.
Temporal: prediction within 24h of sentinel_acquired_at.
Source tagged 'sentinel_proxy', weight 0.5 in build_training_labels.py.

This is the CRITICAL UNLOCK: bypass the 5-7 day WAQI accumulation by leveraging
~383K already-ingested Sentinel cells across Indonesia. Expected uplift: thousands
of labels in seconds.

Run:
    python vayu/jobs/attach_sentinel_ground_truth.py
    python vayu/jobs/attach_sentinel_ground_truth.py --radius-km 3 --window-hours 12
    python vayu/jobs/attach_sentinel_ground_truth.py --dry-run
"""

from __future__ import annotations
import argparse
import logging
import os
import sys

import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('attach_sentinel')


def attach(conn, radius_km: float, window_hours: int, dry_run: bool) -> int:
    sql_count_before = """
        SELECT COUNT(*) FROM public.prediction_logs WHERE ground_truth_pm25 IS NOT NULL
    """
    # Efficient pattern: pre-compute road centroids to a CTE (once), then for
    # each prediction LATERAL-join to the single nearest sentinel cell via
    # K-NN <-> operator (index-backed) bounded by a small bbox + recency window.
    sql_attach = """
        WITH pl_targets AS (
          SELECT pl.id AS pl_id, pl.osm_way_id, pl.predicted_at,
                 ST_Centroid(rs.geom)::GEOMETRY(Point, 4326) AS road_pt,
                 ST_X(ST_Centroid(rs.geom))::DOUBLE PRECISION AS rlng,
                 ST_Y(ST_Centroid(rs.geom))::DOUBLE PRECISION AS rlat
          FROM public.prediction_logs pl
          JOIN public.road_segments rs USING (osm_way_id)
          WHERE pl.ground_truth_pm25 IS NULL
        ),
        matched AS (
          SELECT t.pl_id, nn.pm25, nn.dist_km, nn.sentinel_acquired_at
          FROM pl_targets t
          CROSS JOIN LATERAL (
            SELECT
              s.sentinel_pm25_proxy AS pm25,
              ST_DistanceSphere(
                t.road_pt,
                ST_SetSRID(ST_MakePoint(s.centroid_lng, s.centroid_lat), 4326)
              ) / 1000.0 AS dist_km,
              s.sentinel_acquired_at
            FROM public.aqi_grid_sentinel s
            WHERE s.sentinel_pm25_proxy IS NOT NULL
              AND s.sentinel_pm25_proxy BETWEEN 5 AND 500
              AND s.centroid_lng BETWEEN t.rlng - %(deg_radius)s AND t.rlng + %(deg_radius)s
              AND s.centroid_lat BETWEEN t.rlat - %(deg_radius)s AND t.rlat + %(deg_radius)s
              AND ABS(EXTRACT(EPOCH FROM (s.sentinel_acquired_at - t.predicted_at))) < %(window_s)s
            ORDER BY t.road_pt <-> ST_SetSRID(ST_MakePoint(s.centroid_lng, s.centroid_lat), 4326)
            LIMIT 1
          ) nn
          WHERE nn.dist_km <= %(radius_km)s
        )
        UPDATE public.prediction_logs pl
        SET ground_truth_pm25 = m.pm25,
            ground_truth_source = 'sentinel_proxy',
            ground_truth_distance_km = m.dist_km,
            ground_truth_at = m.sentinel_acquired_at
        FROM matched m
        WHERE m.pl_id = pl.id;
    """
    with conn.cursor() as cur:
        cur.execute(sql_count_before)
        n_before = cur.fetchone()[0]

        if dry_run:
            deg_radius = radius_km / 111.0
            cur.execute(
                "EXPLAIN " + sql_attach,
                {'radius_km': radius_km, 'deg_radius': deg_radius, 'window_s': window_hours * 3600},
            )
            for row in cur.fetchall():
                log.info(f'  PLAN: {row[0]}')
            return 0

        # deg_radius: convert km to ~degrees at equator for bbox pre-filter
        deg_radius = radius_km / 111.0
        cur.execute(sql_attach, {
            'radius_km': radius_km,
            'deg_radius': deg_radius,
            'window_s': window_hours * 3600,
        })
        n_updated = cur.rowcount
        conn.commit()

        cur.execute(sql_count_before)
        n_after = cur.fetchone()[0]

    log.info(f'attach complete: {n_before} → {n_after} labeled rows (+{n_updated} updates this run)')
    return n_updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--radius-km', type=float, default=5.0,
                        help='Spatial proximity threshold (default 5 km — Sentinel-5P grid is ~7 km)')
    parser.add_argument('--window-hours', type=int, default=24,
                        help='Temporal alignment window (default 24h — Sentinel is daily/orbital)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    load_dotenv('.env.local')
    pooler = os.environ.get('SUPABASE_POOLER_URL')
    if not pooler:
        log.error('SUPABASE_POOLER_URL missing')
        sys.exit(2)

    log.info(f'connecting to pooler (radius={args.radius_km}km window={args.window_hours}h)')
    with psycopg2.connect(pooler) as conn:
        with conn.cursor() as cur:
            cur.execute('SET statement_timeout = 0')
        attach(conn, args.radius_km, args.window_hours, args.dry_run)


if __name__ == '__main__':
    main()
