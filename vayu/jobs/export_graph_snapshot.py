"""
Tier 3 Phase 3.0.3 — Export road graph snapshot ke parquet untuk training GCN.

Output ke D:/breeva-ml-data/graph/:
  nodes.parquet   — node features per osm_way_id (joined dari mv_road_graph_nodes)
  edges.parquet   — edge_index dari gcn_graph_edges (source_way, target_way)
  labels.parquet  — ground truth dari prediction_logs (where ground_truth_pm25 NOT NULL)

Tier 4 Phase 4.0 update: residual_pm25 target = (ground_truth - corrected_pm25),
not (ground_truth - predicted_pm25). Both kept for diagnostic.

Run:
    python vayu/jobs/export_graph_snapshot.py
    python vayu/jobs/export_graph_snapshot.py --region jakarta
    python vayu/jobs/export_graph_snapshot.py --refresh-mv
"""

from __future__ import annotations
import argparse
import logging
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
import psycopg2
import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('export_graph')

REGIONS_TIER1 = [
    'jakarta', 'bali', 'bandung', 'surabaya', 'semarang',
    'yogyakarta', 'solo', 'medan', 'palembang', 'makassar', 'denpasar',
]


def export_nodes(conn, output_dir: Path, regions: list[str]) -> int:
    sql = """
        SELECT osm_way_id, region, highway, lanes, width, surface, maxspeed,
               landuse_proxy, canyon_ratio, elevation_avg, traffic_base_estimate,
               traffic_calibration_factor, ai_pollution_factor, ai_classified,
               lng, lat, length_m, gcn_node_id
        FROM mv_road_graph_nodes
        WHERE region = ANY(%s)
    """
    df = pd.read_sql_query(sql, conn, params=(regions,))
    log.info(f'loaded {len(df)} nodes')
    out = output_dir / 'nodes.parquet'
    df.to_parquet(out, index=False, compression='snappy')
    log.info(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')
    return len(df)


def export_edges(conn, output_dir: Path, regions: list[str]) -> int:
    """Edges from gcn_graph_edges (Phase 3.0a topology).

    For each edge (source_node, target_node), map back to osm_way_id pair.
    Symmetrize is done at PyG dataset build time.
    """
    sql = """
        SELECT
          ns.osm_way_id AS source_way,
          nt.osm_way_id AS target_way,
          e.distance_m,
          e.edge_type,
          e.weight
        FROM gcn_graph_edges e
        JOIN gcn_graph_nodes ns ON ns.node_id = e.source_node
        JOIN gcn_graph_nodes nt ON nt.node_id = e.target_node
        WHERE ns.region = ANY(%s) AND nt.region = ANY(%s)
    """
    df = pd.read_sql_query(sql, conn, params=(regions, regions))
    log.info(f'loaded {len(df)} edges')
    out = output_dir / 'edges.parquet'
    df.to_parquet(out, index=False, compression='snappy')
    log.info(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')
    return len(df)


def export_labels(conn, output_dir: Path) -> int:
    """Export labeled predictions. Two targets stored:
      residual_caline    = truth - predicted_pm25 (original Tier 3 target, kept for diagnostic)
      residual_corrected = truth - corrected_pm25 (Tier 4 Phase 4.0 target — primary)
    """
    sql = """
        SELECT
          osm_way_id,
          region,
          predicted_pm25,
          corrected_pm25,
          ground_truth_pm25,
          ground_truth_source,
          ground_truth_distance_km,
          EXTRACT(HOUR FROM (predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT AS hour_of_day,
          EXTRACT(DOW FROM (predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT AS dow,
          features,
          (ground_truth_pm25 - predicted_pm25)::REAL AS residual_caline,
          (ground_truth_pm25 - COALESCE(corrected_pm25, predicted_pm25))::REAL AS residual_corrected,
          predicted_at
        FROM prediction_logs
        WHERE ground_truth_pm25 IS NOT NULL
          AND predicted_at > NOW() - INTERVAL '90 days'
          AND (ground_truth_distance_km IS NULL OR ground_truth_distance_km < 5.0)
    """
    df = pd.read_sql_query(sql, conn)
    log.info(f'loaded {len(df)} labels')
    if len(df) == 0:
        log.warning('  WARNING: 0 labels — Phase 3.0b WAQI poller likely not yet accumulated. '
                    'Training will not work until labels exist.')
    out = output_dir / 'labels.parquet'
    df.to_parquet(out, index=False, compression='snappy')
    log.info(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')
    return len(df)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--region', nargs='+', default=REGIONS_TIER1)
    parser.add_argument('--refresh-mv', action='store_true', help='REFRESH mv_road_graph_nodes first')
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    load_dotenv('.env.local')
    pooler = os.environ['SUPABASE_POOLER_URL']
    log.info(f'connecting via pooler...')
    with psycopg2.connect(pooler) as conn:
        # SET statement_timeout=0 supaya long-running export tidak ke-cut
        with conn.cursor() as cur:
            cur.execute('SET statement_timeout = 0')
        if args.refresh_mv:
            log.info('REFRESH MATERIALIZED VIEW mv_road_graph_nodes...')
            with conn.cursor() as cur:
                # NOT CONCURRENTLY first time karena unique idx mungkin belum populated
                cur.execute('REFRESH MATERIALIZED VIEW mv_road_graph_nodes')
            conn.commit()
        n_nodes = export_nodes(conn, output, args.region)
        n_edges = export_edges(conn, output, args.region)
        n_labels = export_labels(conn, output)
    log.info(f'done: {n_nodes} nodes, {n_edges} edges, {n_labels} labels')


if __name__ == '__main__':
    main()
