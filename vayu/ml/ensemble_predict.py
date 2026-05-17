"""
Tier 4 Phase 4.3 — Deep ensemble inference + uncertainty decomposition.

Loads ensemble manifest, runs all members on a dataset, computes:
  - mu_ensemble    = mean of member predictions
  - sigma_aleatoric = sqrt(mean of member sigma²)   — data noise
  - sigma_epistemic = std of member mus              — model uncertainty
  - sigma_total     = sqrt(aleatoric² + epistemic²)

Run:
    python vayu/ml/ensemble_predict.py \
      --manifest D:/breeva-ml-models/gcn/ensemble_t4_phase4_3_manifest.json \
      --output-parquet D:/breeva-ml-data/snapshots/ensemble_predictions.parquet
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
log = logging.getLogger('ensemble_predict')


def load_ensemble(manifest_path: Path, device: torch.device) -> tuple[list[RoadGraphSAGE], dict]:
    with open(manifest_path) as f:
        manifest = json.load(f)
    base = manifest_path.parent
    models: list[RoadGraphSAGE] = []
    for ckpt_name in manifest['checkpoints']:
        ckpt = torch.load(base / ckpt_name, map_location=device)
        m = RoadGraphSAGE(
            in_dim=ckpt['in_dim'],
            hidden=ckpt['hidden'],
            n_layers=ckpt.get('n_layers', 3),
            dropout=ckpt.get('dropout', 0.2),
        ).to(device)
        m.load_state_dict(ckpt['model_state_dict'])
        m.eval()
        models.append(m)
    log.info(f'loaded {len(models)} ensemble members from {manifest_path}')
    return models, manifest


@torch.inference_mode()
def predict_ensemble(models, data, device):
    means = []
    sigmas = []
    for m in models:
        mu, sigma = m(data.x.to(device), data.edge_index.to(device))
        means.append(mu.cpu())
        sigmas.append(sigma.cpu())
    means = torch.stack(means)      # [K, N]
    sigmas = torch.stack(sigmas)    # [K, N]
    mu_ensemble = means.mean(dim=0)
    sigma_aleatoric = torch.sqrt((sigmas ** 2).mean(dim=0))
    sigma_epistemic = means.std(dim=0)
    sigma_total = torch.sqrt(sigma_aleatoric ** 2 + sigma_epistemic ** 2)
    return mu_ensemble, sigma_aleatoric, sigma_epistemic, sigma_total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--output-parquet', required=True)
    parser.add_argument('--hour', type=int, default=12)
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    models, manifest = load_ensemble(Path(args.manifest), device)

    ds = RoadGraphDataset(root=args.data_root, hour=args.hour)
    data = ds[0]
    log.info(f'graph: {data.num_nodes} nodes, {data.edge_index.shape[1]} edges')

    mu, ale, epi, total = predict_ensemble(models, data, device)
    osm_ids = data.osm_way_ids.cpu().numpy()

    df = pd.DataFrame({
        'osm_way_id': osm_ids,
        'hour_of_day': args.hour,
        'pm25_delta_gcn': mu.numpy(),
        'aleatoric_sigma': ale.numpy(),
        'epistemic_sigma': epi.numpy(),
        'uncertainty_sigma': total.numpy(),  # backward-compat alias
        'ensemble_size': len(models),
        'model_version': manifest['tag'],
    })
    out = Path(args.output_parquet)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False, compression='snappy')
    log.info(f'wrote {len(df)} rows -> {out}')
    log.info(f'aleatoric mean={ale.mean():.3f} std={ale.std():.3f}')
    log.info(f'epistemic mean={epi.mean():.3f} std={epi.std():.3f}')


if __name__ == '__main__':
    main()
