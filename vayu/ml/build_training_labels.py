"""
Playbook §2.3 + §3.4 — Build clean training labels with quality gates + weights.

Reads prediction_logs joined with road_segments, applies QUALITY_RULES, computes
per-source confidence weights + per-class + per-region sample weights, emits
cleaned labels.parquet that train_gcn.py consumes.

Run:
    python vayu/ml/build_training_labels.py
    python vayu/ml/build_training_labels.py --output D:/breeva-ml-data/graph/labels.parquet
    python vayu/ml/build_training_labels.py --dry-run  # report only, no write
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('build_training_labels')

# Per-source quality weight (1.0 = perfect ground truth, 0.0 = useless)
SOURCE_WEIGHTS = {
    'waqi':     1.0,
    'iqair':    1.0,
    'sentinel_proxy': 0.5,
    'openaq':   0.7,
    'walk':     0.3,
    'crowd':    0.2,
}

# Quality rule constants — per-source spatial budget because Sentinel-5P grid
# cells are ~7 km wide (matching a station 1:1 is impossible); WAQI/IQAir stations
# are point sensors so tight 2 km is appropriate.
SPATIAL_MAX_KM_BY_SOURCE = {
    'waqi':           2.0,
    'iqair':          2.0,
    'openaq':         3.0,
    'sentinel_proxy': 10.0,  # Sentinel-5P 7×7 km grid, 10 km tolerance
    'walk':           2.0,
    'crowd':          1.0,
}
DEFAULT_SPATIAL_MAX_KM = 5.0

# Temporal budget — Sentinel is daily/orbital so allow up to a week
TEMPORAL_MAX_H_BY_SOURCE = {
    'waqi':           2.0,
    'iqair':          2.0,
    'openaq':         6.0,
    'sentinel_proxy': 168.0,  # 1 week
    'walk':           24.0,
    'crowd':          24.0,
}
DEFAULT_TEMPORAL_MAX_H = 24.0

PM25_MIN = 5.0
PM25_MAX = 500.0
OUTLIER_IQR_FACTOR = 5.0


def load_raw_labels(conn) -> pd.DataFrame:
    sql = """
        SELECT
          pl.id AS pl_id,
          pl.osm_way_id,
          pl.region,
          pl.predicted_pm25,
          pl.corrected_pm25,
          pl.ground_truth_pm25,
          pl.ground_truth_source,
          pl.ground_truth_distance_km,
          pl.ground_truth_at,
          pl.predicted_at,
          EXTRACT(HOUR FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT AS hour_of_day,
          EXTRACT(DOW FROM (pl.predicted_at AT TIME ZONE 'Asia/Jakarta'))::SMALLINT AS dow,
          (pl.ground_truth_pm25 - pl.predicted_pm25)::REAL AS residual_caline,
          (pl.ground_truth_pm25 - COALESCE(pl.corrected_pm25, pl.predicted_pm25))::REAL AS residual_corrected
        FROM public.prediction_logs pl
        WHERE pl.ground_truth_pm25 IS NOT NULL
          AND pl.predicted_at > NOW() - INTERVAL '90 days'
    """
    df = pd.read_sql_query(sql, conn)
    log.info(f'loaded {len(df)} raw labeled rows')
    return df


def apply_quality_gates(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    df = df.copy()  # avoid SettingWithCopy on input view
    n0 = len(df)
    stats: dict[str, int] = {'initial': n0}

    # Rule 1: spatial proximity — per-source budget
    if 'ground_truth_distance_km' in df.columns:
        df['_spatial_budget_km'] = df['ground_truth_source'].map(SPATIAL_MAX_KM_BY_SOURCE).fillna(DEFAULT_SPATIAL_MAX_KM)
        before = len(df)
        df = df[(df['ground_truth_distance_km'].isna()) | (df['ground_truth_distance_km'] <= df['_spatial_budget_km'])]
        stats['rejected_spatial'] = before - len(df)
        df = df.drop(columns=['_spatial_budget_km'])

    # Rule 2: temporal alignment — per-source budget
    df['gt_lag_hours'] = (df['ground_truth_at'] - df['predicted_at']).abs().dt.total_seconds() / 3600
    df['_temporal_budget_h'] = df['ground_truth_source'].map(TEMPORAL_MAX_H_BY_SOURCE).fillna(DEFAULT_TEMPORAL_MAX_H)
    before = len(df)
    df = df[(df['gt_lag_hours'].isna()) | (df['gt_lag_hours'] <= df['_temporal_budget_h'])]
    stats['rejected_temporal'] = before - len(df)
    df = df.drop(columns=['_temporal_budget_h'])

    # Rule 3: physically realistic
    before = len(df)
    df = df[(df['ground_truth_pm25'] >= PM25_MIN) & (df['ground_truth_pm25'] <= PM25_MAX)]
    stats['rejected_range'] = before - len(df)

    # Rule 4: outlier — flag (NOT reject) extreme regional events
    df['is_extreme'] = False
    for region in df['region'].unique():
        sub = df[df['region'] == region]
        if len(sub) < 10:
            continue
        median = sub['ground_truth_pm25'].median()
        iqr = sub['ground_truth_pm25'].quantile(0.75) - sub['ground_truth_pm25'].quantile(0.25)
        threshold = OUTLIER_IQR_FACTOR * max(iqr, 1.0)
        mask = (df['region'] == region) & ((df['ground_truth_pm25'] - median).abs() > threshold)
        df.loc[mask, 'is_extreme'] = True
    stats['flagged_extreme'] = int(df['is_extreme'].sum())

    # Rule 5: dedup — same (osm_way_id, ground_truth_at to nearest 5-min) → keep nearest
    before = len(df)
    df['gt_at_5min'] = df['ground_truth_at'].dt.floor('5min')
    df = (df.sort_values('ground_truth_distance_km')
            .drop_duplicates(subset=['osm_way_id', 'gt_at_5min']))
    stats['rejected_dedup'] = before - len(df)
    df = df.drop(columns=['gt_at_5min', 'gt_lag_hours'])

    stats['final'] = len(df)
    return df, stats


def compute_weights(df: pd.DataFrame) -> pd.DataFrame:
    # Source quality weight
    df['weight_source'] = df['ground_truth_source'].map(SOURCE_WEIGHTS).fillna(0.3)

    # Per-region weight: 1 / sqrt(region_frequency) — Jakarta dominance penalty
    region_counts = df['region'].value_counts(normalize=True)
    df['weight_region'] = df['region'].map(lambda r: 1.0 / np.sqrt(region_counts.get(r, 0.01)))

    # Extreme event downweight (don't let one fire dominate gradient)
    df['weight_extreme'] = np.where(df['is_extreme'], 0.3, 1.0)

    # Combined
    df['weight'] = df['weight_source'] * df['weight_region'] * df['weight_extreme']
    # Normalize so mean weight = 1.0
    df['weight'] = df['weight'] / df['weight'].mean()
    return df


def write_parquet(df: pd.DataFrame, output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output, index=False, compression='snappy')
    log.info(f'wrote {output} ({output.stat().st_size / 1e6:.2f} MB, {len(df)} rows)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='D:/breeva-ml-data/graph/labels.parquet')
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
        df = load_raw_labels(conn)

    if len(df) == 0:
        log.warning('zero labels found — populate ground_truth_pm25 first '
                    '(run snapshot_stations.py + attach_sentinel_ground_truth.py)')
        sys.exit(0)

    df, gate_stats = apply_quality_gates(df)
    log.info('quality gates:')
    for k, v in gate_stats.items():
        log.info(f'  {k:20s} {v}')

    df = compute_weights(df)
    log.info(f'final weighted labels by region:')
    summary = df.groupby('region').agg(
        n=('osm_way_id', 'count'),
        mean_pm25=('ground_truth_pm25', 'mean'),
        mean_weight=('weight', 'mean'),
        sources=('ground_truth_source', lambda s: ','.join(s.unique())),
    )
    log.info(f'\n{summary}')

    if args.dry_run:
        log.info('--dry-run: not writing parquet')
    else:
        write_parquet(df, Path(args.output))


if __name__ == '__main__':
    main()
