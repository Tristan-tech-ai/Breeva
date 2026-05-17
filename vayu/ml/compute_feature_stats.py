"""
Playbook §3.2 — Compute per-snapshot feature normalization stats.

Recompute mean/std/quartiles per numeric feature on freshly-exported parquet.
Output JSON manifest that train_gcn.py + train_stgcn.py + precompute_gcn.py all
load + apply identically. Ensures training-serving parity.

Run:
    python vayu/ml/compute_feature_stats.py --snapshot D:/breeva-ml-data/graph/nodes.parquet
    python vayu/ml/compute_feature_stats.py --tier t4 --include-tier4
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
from pathlib import Path

import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('compute_feature_stats')

TIER3_NUMERIC = [
    'lanes', 'width', 'maxspeed', 'canyon_ratio', 'elevation_avg',
    'traffic_base_estimate', 'traffic_calibration_factor',
    'ai_pollution_factor', 'lng', 'lat', 'length_m',
]

TIER4_NUMERIC = [
    'tomtom_congestion_factor',
    'sentinel_no2', 'sentinel_co', 'sentinel_so2',
    'forecast_pm25_h0', 'forecast_pm25_h1', 'forecast_pm25_h3',
    'feedback_accuracy_ema', 'dist_industrial_m', 'crowd_speed_dev_pct',
]


def compute(snapshot_path: Path, output_path: Path, include_tier4: bool):
    df = pd.read_parquet(snapshot_path)
    log.info(f'loaded {len(df)} rows × {len(df.columns)} cols')
    fields = TIER3_NUMERIC + (TIER4_NUMERIC if include_tier4 else [])

    stats: dict[str, dict] = {}
    for f in fields:
        if f not in df.columns:
            log.warning(f'  field {f} missing from snapshot — skipped')
            continue
        s = df[f].dropna()
        if len(s) == 0:
            log.warning(f'  field {f} all-null — skipped')
            continue
        stats[f] = {
            'mean': float(s.mean()),
            'std': float(s.std() or 1.0),
            'median': float(s.median()),
            'q1': float(s.quantile(0.25)),
            'q3': float(s.quantile(0.75)),
            'min': float(s.min()),
            'max': float(s.max()),
            'n_nonnull': int(len(s)),
            'pct_null': float(1.0 - len(s) / len(df)),
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        'snapshot': str(snapshot_path),
        'n_rows': int(len(df)),
        'tier': 't4' if include_tier4 else 't3',
        'features': stats,
    }, indent=2))
    log.info(f'wrote {output_path} ({len(stats)} features)')

    # Sanity print: any feature with very high coefficient of variation
    for name, s in stats.items():
        cv = abs(s['std']) / (abs(s['mean']) + 1e-9)
        if cv > 10:
            log.warning(f'  HIGH CV: {name} mean={s["mean"]:.3f} std={s["std"]:.3f} cv={cv:.1f}')
        if s['pct_null'] > 0.5:
            log.warning(f'  HIGH NULL: {name} pct_null={s["pct_null"]:.1%}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', default='D:/breeva-ml-data/graph/nodes.parquet')
    parser.add_argument('--output', default=None,
                        help='Defaults to vayu/ml/feature_stats_t3.json or _t4.json')
    parser.add_argument('--include-tier4', action='store_true')
    args = parser.parse_args()

    snapshot = Path(args.snapshot)
    if not snapshot.exists():
        log.error(f'snapshot not found: {snapshot}')
        sys.exit(2)

    output = Path(args.output) if args.output else (
        Path(__file__).parent / ('feature_stats_t4.json' if args.include_tier4 else 'feature_stats_t3.json')
    )
    compute(snapshot, output, args.include_tier4)


if __name__ == '__main__':
    main()
