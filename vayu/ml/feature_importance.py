"""
Playbook §3.6 — Per-feature gradient saliency for trained GraphSAGE.

For each input feature dim, compute |gradient| of val_mae w.r.t. that feature
averaged across val nodes. Reveals which features the model actually uses.

Flags:
  - Single feature > 50% of total saliency → likely overfit
  - Tier 4 feature < 1% saliency → candidate for removal (over-parameterized)

Run:
    python vayu/ml/feature_importance.py --model-path D:/breeva-ml-models/gcn/best.pt
"""

from __future__ import annotations
import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_dataset import RoadGraphDataset  # noqa: E402
from vayu.ml.gcn_features import (  # noqa: E402
    HIGHWAY_CLASSES, LANDUSE_CLASSES, SURFACE_CLASSES, REGIONS,
    TIER4_FEATURE_NAMES, USE_TIER4_FEATURES,
)
from vayu.ml.gcn_model import RoadGraphSAGE  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('feature_importance')


def build_feature_names() -> list[str]:
    names: list[str] = []
    names += [f'highway_{c}' for c in HIGHWAY_CLASSES]
    names += [f'landuse_{c}' for c in LANDUSE_CLASSES]
    names += [f'surface_{c}' for c in SURFACE_CLASSES]
    names += [f'region_{c}' for c in REGIONS]
    names += [
        'lanes_log', 'width_log', 'maxspeed_log', 'canyon_ratio',
        'elevation_log', 'traffic_base_log', 'traffic_cal',
        'ai_pollution', 'ai_classified', 'lng_norm', 'lat_norm', 'length_log',
        'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
    ]
    if USE_TIER4_FEATURES:
        names += TIER4_FEATURE_NAMES
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-path', required=True)
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--output', default='D:/breeva-ml-models/gcn/feature_importance.json')
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    ckpt = torch.load(args.model_path, map_location=device)
    model = RoadGraphSAGE(
        in_dim=ckpt['in_dim'],
        hidden=ckpt['hidden'],
        n_layers=ckpt.get('n_layers', 3),
        dropout=0.0,  # disable dropout for saliency
    ).to(device)
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    ds = RoadGraphDataset(root=args.data_root, target_col=ckpt.get('target_col', 'residual_corrected'))
    data = ds[0].to(device)
    data.x.requires_grad_(True)

    if int(data.val_mask.sum()) == 0:
        log.error('no val labels — train a model with labels first')
        sys.exit(2)

    mu, _ = model(data.x, data.edge_index)
    val_mask = data.val_mask
    target = data.y[val_mask]
    pred = mu[val_mask]
    loss = (pred - target).abs().mean()
    loss.backward()

    grads = data.x.grad.abs()  # [N, F]
    val_grads = grads[val_mask].mean(dim=0).cpu().numpy()
    total = float(val_grads.sum()) or 1.0
    importance_pct = val_grads / total

    names = build_feature_names()
    if len(names) != len(importance_pct):
        log.warning(f'name list ({len(names)}) != feature_dim ({len(importance_pct)}) — using index labels')
        names = [f'f{i}' for i in range(len(importance_pct))]

    ranked = sorted(zip(names, importance_pct), key=lambda x: -x[1])
    report = {
        'model_path': str(args.model_path),
        'total_saliency': total,
        'top_20': [{'feature': n, 'pct': float(p)} for n, p in ranked[:20]],
        'bottom_10': [{'feature': n, 'pct': float(p)} for n, p in ranked[-10:]],
        'flags': [],
    }
    if ranked[0][1] > 0.5:
        report['flags'].append(f'DOMINANT_FEATURE: {ranked[0][0]} = {ranked[0][1]:.1%} of total saliency')
    weak = [(n, p) for n, p in ranked if p < 0.01]
    if weak:
        report['flags'].append(f'{len(weak)} features below 1% saliency — candidates for removal')

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    log.info(f'wrote {args.output}')
    log.info(f'TOP 5: {ranked[:5]}')
    for f in report['flags']:
        log.warning(f'  FLAG: {f}')


if __name__ == '__main__':
    main()
