"""
Tier 3 Phase 3.3 — Comprehensive validation:
  1. Per highway class MAE breakdown
  2. Per region MAE breakdown
  3. Moran's I spatial autocorrelation of residuals (sparse computation)
  4. Average predicted uncertainty (sigma)

Output: D:/breeva-ml-models/gcn/validation_report.json

Run:
    python vayu/ml/validate_gcn.py --model-path D:/breeva-ml-models/gcn/gcn_road_v*.pt
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_dataset import RoadGraphDataset  # noqa: E402
from vayu.ml.gcn_model import RoadGraphSAGE  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('validate_gcn')


def morans_i_sparse(values: np.ndarray, edge_index: np.ndarray) -> float:
    """Sparse Moran's I via edge_index (avoids N×N matrix).

    I = (N / W) * Σ_ij w_ij (z_i - z̄)(z_j - z̄) / Σ_i (z_i - z̄)²

    Uses w_ij = 1 for each directed edge. W = number of edges. Skips NaN values.
    """
    z = values - np.nanmean(values)
    src, dst = edge_index[0], edge_index[1]
    mask = ~np.isnan(z[src]) & ~np.isnan(z[dst])
    if mask.sum() == 0:
        return float('nan')
    num = float(np.nansum(z[src][mask] * z[dst][mask]))
    den = float(np.nansum(z * z))
    if den == 0:
        return float('nan')
    n = len(values)
    w = int(mask.sum())
    return (n / w) * (num / den)


@torch.no_grad()
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-path', required=True)
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--output', default='D:/breeva-ml-models/gcn/validation_report.json')
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    ckpt = torch.load(args.model_path, map_location=device)
    model = RoadGraphSAGE(
        in_dim=ckpt['in_dim'],
        hidden=ckpt['hidden'],
        n_layers=ckpt.get('n_layers', 3),
        dropout=ckpt.get('dropout', 0.2),
    ).to(device)
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    target_col = ckpt.get('target_col', 'residual_corrected')
    ds = RoadGraphDataset(root=args.data_root, target_col=target_col)
    data = ds[0].to(device)

    pred, sigma = model(data.x, data.edge_index)
    pred_np = pred.cpu().numpy()
    target_np = data.y.cpu().numpy()
    sigma_np = sigma.cpu().numpy()
    edge_index_np = data.edge_index.cpu().numpy()
    test_mask = data.test_mask.cpu().numpy()

    nodes = pd.read_parquet(Path(args.data_root) / 'nodes.parquet')

    # Per highway breakdown
    by_highway = {}
    for hw in nodes['highway'].dropna().unique():
        idx = (nodes['highway'] == hw).values & test_mask & ~np.isnan(target_np)
        if idx.sum() < 5:
            continue
        by_highway[str(hw)] = {
            'n': int(idx.sum()),
            'mae': float(np.abs(pred_np[idx] - target_np[idx]).mean()),
            'rmse': float(np.sqrt(((pred_np[idx] - target_np[idx]) ** 2).mean())),
        }

    # Per region breakdown
    by_region = {}
    for rg in nodes['region'].dropna().unique():
        idx = (nodes['region'] == rg).values & test_mask & ~np.isnan(target_np)
        if idx.sum() < 5:
            continue
        by_region[str(rg)] = {
            'n': int(idx.sum()),
            'mae': float(np.abs(pred_np[idx] - target_np[idx]).mean()),
            'rmse': float(np.sqrt(((pred_np[idx] - target_np[idx]) ** 2).mean())),
        }

    test_idx = test_mask & ~np.isnan(target_np)
    overall = {
        'n': int(test_idx.sum()),
        'mae': float(np.abs(pred_np[test_idx] - target_np[test_idx]).mean()) if test_idx.sum() > 0 else None,
        'rmse': float(np.sqrt(((pred_np[test_idx] - target_np[test_idx]) ** 2).mean())) if test_idx.sum() > 0 else None,
    }

    # Spatial autocorrelation of residual error (pred - target)
    residual_error = pred_np - target_np
    morans = morans_i_sparse(residual_error, edge_index_np)

    report = {
        'model_path': str(args.model_path),
        'target_col': target_col,
        'overall': overall,
        'by_highway': by_highway,
        'by_region': by_region,
        'avg_uncertainty': float(sigma_np.mean()),
        'morans_i_residual': morans,
        'note': "morans_i near 0 = residuals decorrelated (good); high = clustered errors (bad)",
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w') as f:
        json.dump(report, f, indent=2)
    log.info(f'wrote {out}')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
