"""
Tier 3 Phase 3.2.2 — Train GraphSAGE for road-level PM2.5 residual prediction.

Run:
    python vayu/ml/train_gcn.py
    python vayu/ml/train_gcn.py --epochs 100 --lr 1e-3 --batch-size 4096

Logs to MLflow at http://127.0.0.1:8080 (override via MLFLOW_TRACKING_URI).
Model artifact saved to D:/breeva-ml-models/gcn/gcn_road_v{TIMESTAMP}.pt
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import mlflow
import mlflow.pytorch
import torch
import torch.nn.functional as F
from torch_geometric.loader import NeighborLoader

# allow run as script
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_dataset import RoadGraphDataset  # noqa: E402
from vayu.ml.gcn_model import RoadGraphSAGE  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('train_gcn')

MLFLOW_URI = os.environ.get('MLFLOW_TRACKING_URI', 'http://127.0.0.1:8080')
MODEL_DIR = Path(os.environ.get('GCN_MODEL_DIR', 'D:/breeva-ml-models/gcn/'))


def gaussian_nll_loss(pred: torch.Tensor, target: torch.Tensor, sigma: torch.Tensor) -> torch.Tensor:
    """Gaussian NLL with predicted variance — learns aleatoric uncertainty."""
    var = sigma ** 2
    return 0.5 * (torch.log(var) + ((pred - target) ** 2) / var).mean()


def smoothness_loss(pred: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
    """Penalize residual variance across edges (encourage spatial smoothness)."""
    src, dst = edge_index[0], edge_index[1]
    diff = pred[src] - pred[dst]
    return diff.pow(2).mean()


def train_epoch(model, loader, optimizer, device, lambda_smooth: float = 0.1):
    model.train()
    total_loss = 0.0
    total_count = 0
    for batch in loader:
        batch = batch.to(device)
        optimizer.zero_grad()
        residual, sigma = model(batch.x, batch.edge_index)
        # only compute loss on labeled nodes in this batch's input set
        mask = batch.train_mask[:batch.batch_size]
        if mask.sum() == 0:
            continue
        target = batch.y[:batch.batch_size][mask]
        pred = residual[:batch.batch_size][mask]
        s = sigma[:batch.batch_size][mask]
        data_loss = gaussian_nll_loss(pred, target, s)
        # smoothness across all sampled nodes (not just seeds) — edge_index spans full subgraph
        smooth = smoothness_loss(residual, batch.edge_index)
        loss = data_loss + lambda_smooth * smooth
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        total_loss += loss.item() * mask.sum().item()
        total_count += mask.sum().item()
    return total_loss / max(total_count, 1)


@torch.no_grad()
def evaluate(model, data, mask, device):
    model.eval()
    data = data.to(device)
    residual, sigma = model(data.x, data.edge_index)
    pred = residual[mask].cpu().numpy()
    target = data.y[mask].cpu().numpy()
    mae = float(((pred - target).__abs__()).mean()) if mask.sum() > 0 else float('nan')
    rmse = float(((pred - target) ** 2).mean() ** 0.5) if mask.sum() > 0 else float('nan')
    return {'mae': mae, 'rmse': rmse, 'n': int(mask.sum().item())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=80)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--batch-size', type=int, default=4096)
    parser.add_argument('--hidden', type=int, default=64)
    parser.add_argument('--dropout', type=float, default=0.2)
    parser.add_argument('--lambda-smooth', type=float, default=0.1)
    parser.add_argument('--patience', type=int, default=10)
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--target-col', default='residual_corrected',
                        help='Tier 4 Phase 4.0: residual_corrected; original Tier 3: residual_caline')
    parser.add_argument('--warm-start', default=None,
                        help='Path to checkpoint to warm-start weights from (Phase 3.6.2)')
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')
    if device.type == 'cuda':
        log.info(f'GPU: {torch.cuda.get_device_name(0)} ({torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB)')

    ds = RoadGraphDataset(root=args.data_root, target_col=args.target_col)
    data = ds[0]
    log.info(f'graph: {data.num_nodes} nodes, {data.edge_index.shape[1]} edges, in_dim={data.x.shape[1]}')
    log.info(f'split: train={int(data.train_mask.sum())} val={int(data.val_mask.sum())} test={int(data.test_mask.sum())}')

    if int(data.train_mask.sum()) == 0:
        log.error('No training labels — populate prediction_logs.ground_truth_pm25 first (Phase 3.0b).')
        sys.exit(2)

    train_loader = NeighborLoader(
        data,
        num_neighbors=[25, 10, 10],
        batch_size=args.batch_size,
        input_nodes=data.train_mask,
        shuffle=True,
    )

    model = RoadGraphSAGE(in_dim=data.x.shape[1], hidden=args.hidden, dropout=args.dropout).to(device)
    log.info(f'model: {sum(p.numel() for p in model.parameters()):,} params')

    if args.warm_start:
        ckpt = torch.load(args.warm_start, map_location=device)
        try:
            model.load_state_dict(ckpt['model_state_dict'], strict=False)
            log.info(f'warm-start loaded from {args.warm_start} (epoch {ckpt.get("epoch")}, val_mae {ckpt.get("val_mae")})')
        except Exception as e:
            log.warning(f'warm-start failed ({e}); training from scratch')

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment('breeva_gcn_road')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    with mlflow.start_run(run_name=f'gcn_road_v{timestamp}'):
        mlflow.log_params(vars(args))
        mlflow.log_param('num_nodes', data.num_nodes)
        mlflow.log_param('num_edges', data.edge_index.shape[1])
        mlflow.log_param('feature_dim', data.x.shape[1])
        mlflow.log_param('target_col', args.target_col)

        best_val_mae = float('inf')
        patience_left = args.patience
        best_path = None
        for epoch in range(1, args.epochs + 1):
            t0 = time.time()
            loss = train_epoch(model, train_loader, optimizer, device, args.lambda_smooth)
            scheduler.step()
            val = evaluate(model, data, data.val_mask, device)
            mlflow.log_metrics({
                'train_loss': loss,
                'val_mae': val['mae'],
                'val_rmse': val['rmse'],
                'lr': optimizer.param_groups[0]['lr'],
            }, step=epoch)
            log.info(f'ep {epoch:3d} | loss {loss:.4f} | val MAE {val["mae"]:.3f} RMSE {val["rmse"]:.3f} | {time.time()-t0:.1f}s')
            if val['mae'] < best_val_mae - 0.05:
                best_val_mae = val['mae']
                patience_left = args.patience
                best_path = MODEL_DIR / f'gcn_road_v{timestamp}.pt'
                torch.save({
                    'model_state_dict': model.state_dict(),
                    'in_dim': data.x.shape[1],
                    'hidden': args.hidden,
                    'n_layers': model.n_layers,
                    'dropout': args.dropout,
                    'target_col': args.target_col,
                    'epoch': epoch,
                    'val_mae': val['mae'],
                }, best_path)
                log.info(f'  → checkpoint saved {best_path}')
            else:
                patience_left -= 1
                if patience_left == 0:
                    log.info(f'early stop at epoch {epoch} (no improvement {args.patience} epochs)')
                    break

        test = evaluate(model, data, data.test_mask, device)
        mlflow.log_metrics({'test_mae': test['mae'], 'test_rmse': test['rmse']})
        log.info(f'test MAE {test["mae"]:.3f} RMSE {test["rmse"]:.3f} (n={test["n"]})')

        if best_path is not None:
            mlflow.log_artifact(str(best_path))
        mlflow.pytorch.log_model(model, 'model')

    log.info(f'done. best val MAE: {best_val_mae:.3f}')


if __name__ == '__main__':
    main()
