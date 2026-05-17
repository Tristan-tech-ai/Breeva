"""
Tier 3 Phase 3.4.2 — Nightly precompute job.

Loads latest active GCN model, for each hour 0-23 does a full-graph forward pass,
upserts (osm_way_id, hour_of_day) → (pm25_delta_gcn, uncertainty_sigma,
variance_index, model_version) to gcn_road_predictions.

Throughput target: ~10 min on RTX 5060 Ti for 450k nodes × 24 hours.

Run:
    python vayu/ml/precompute_gcn.py
    python vayu/ml/precompute_gcn.py --batch-hours 24 --model-dir D:/breeva-ml-models/gcn/

Schedule nightly 02:00 WIB via Windows Task Scheduler.
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
import psycopg2
import torch
from dotenv import load_dotenv
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_dataset import RoadGraphDataset  # noqa: E402
from vayu.ml.gcn_model import RoadGraphSAGE  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('precompute_gcn')


def find_latest_model(model_dir: Path) -> Path:
    candidates = sorted(model_dir.glob('gcn_road_v*.pt'), key=lambda p: p.stat().st_mtime)
    if not candidates:
        raise FileNotFoundError(f'no model found in {model_dir}')
    return candidates[-1]


@torch.no_grad()
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', default='D:/breeva-ml-models/gcn/')
    parser.add_argument('--model-path', default=None,
                        help='explicit checkpoint path; if omitted, uses latest in model-dir')
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--batch-hours', type=int, default=24)
    parser.add_argument('--dow', type=int, default=1, help='day-of-week to encode (0=Sun..6=Sat)')
    args = parser.parse_args()

    if Path('.env.local').exists():
        load_dotenv('.env.local')

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    model_path = Path(args.model_path) if args.model_path else find_latest_model(Path(args.model_dir))
    log.info(f'loading model: {model_path}')
    ckpt = torch.load(model_path, map_location=device)
    model = RoadGraphSAGE(
        in_dim=ckpt['in_dim'],
        hidden=ckpt['hidden'],
        n_layers=ckpt.get('n_layers', 3),
        dropout=ckpt.get('dropout', 0.2),
    ).to(device)
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    pooler = os.environ.get('SUPABASE_POOLER_URL')
    if not pooler:
        log.error('SUPABASE_POOLER_URL missing')
        sys.exit(2)
    log.info('connecting to pooler...')
    conn = psycopg2.connect(pooler)
    with conn.cursor() as cur:
        cur.execute('SET statement_timeout = 0')

    model_version = model_path.stem  # gcn_road_v20260530_120000

    total = 0
    for hour in range(args.batch_hours):
        t0 = time.time()
        ds = RoadGraphDataset(root=args.data_root, hour=hour, dow=args.dow, target_col=ckpt.get('target_col', 'residual_corrected'))
        data = ds[0].to(device)

        residual, sigma = model(data.x, data.edge_index)
        residual_np = residual.cpu().numpy()
        sigma_np = sigma.cpu().numpy()
        osm_ids = data.osm_way_ids.cpu().numpy()

        ptp = np.ptp(residual_np)
        var_idx = (residual_np - residual_np.min()) / (ptp + 1e-6)

        rows = list(zip(
            osm_ids.tolist(),
            [hour] * len(osm_ids),
            residual_np.tolist(),
            sigma_np.tolist(),
            var_idx.tolist(),
            [model_version] * len(osm_ids),
        ))

        sql = """
            INSERT INTO public.gcn_road_predictions
              (osm_way_id, hour_of_day, pm25_delta_gcn, uncertainty_sigma, variance_index, model_version)
            VALUES %s
            ON CONFLICT (osm_way_id, hour_of_day) DO UPDATE SET
              pm25_delta_gcn = EXCLUDED.pm25_delta_gcn,
              uncertainty_sigma = EXCLUDED.uncertainty_sigma,
              variance_index = EXCLUDED.variance_index,
              model_version = EXCLUDED.model_version,
              predicted_at = NOW()
        """
        with conn.cursor() as cur:
            execute_values(cur, sql, rows, page_size=1000)
        conn.commit()
        total += len(rows)
        log.info(f'hour {hour:02d} → upserted {len(rows)} ({time.time()-t0:.1f}s)')

    conn.close()
    log.info(f'done. total upserts: {total} (≈ {total // max(args.batch_hours, 1)} nodes × {args.batch_hours} hours)')


if __name__ == '__main__':
    main()
