"""
Tier 4 Phase 4.4 — Train ST-GNN (GraphSAGE x GRU) for 24h per-road PM2.5
forecasting.

Run:
    python vayu/ml/train_stgcn.py --epochs 60 --batch-size 1
    python vayu/ml/train_stgcn.py --warm-start D:/breeva-ml-models/gcn/best.pt

VRAM: ~8 GB peak at batch=1 with fp16 autocast on RTX 5060 Ti.
Wall-clock estimate: ~2-3 hours for 60 epochs on 450k-node graph.
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
import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.stgcn_dataset import STGNNDataset  # noqa: E402
from vayu.ml.stgcn_model import STGNN, masked_gaussian_nll_loss  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('train_stgcn')

MLFLOW_URI = os.environ.get('MLFLOW_TRACKING_URI', 'http://127.0.0.1:8080')
MODEL_DIR = Path(os.environ.get('STGCN_MODEL_DIR', 'D:/breeva-ml-models/stgcn/'))


def collate(samples):
    # Single-sample batch only (T=24 expansion blows up memory)
    return samples[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--hidden', type=int, default=64)
    parser.add_argument('--dropout', type=float, default=0.1)
    parser.add_argument('--patience', type=int, default=8)
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    parser.add_argument('--history-hours', type=int, default=24)
    parser.add_argument('--forecast-hours', type=int, default=24)
    parser.add_argument('--warm-start', default=None)
    parser.add_argument('--tag', default='t4_phase4_4')
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    ds = STGNNDataset(
        graph_root=args.data_root,
        history_hours=args.history_hours,
        forecast_hours=args.forecast_hours,
    )
    if len(ds) == 0:
        log.error('no anchors — need labeled prediction_logs to span the forecast window')
        sys.exit(2)

    n_train = max(1, int(len(ds) * 0.7))
    n_val = max(1, (len(ds) - n_train) // 2)
    indices = list(range(len(ds)))
    train_idx, val_idx, test_idx = indices[:n_train], indices[n_train:n_train + n_val], indices[n_train + n_val:]
    log.info(f'split: train={len(train_idx)} val={len(val_idx)} test={len(test_idx)}')

    from torch.utils.data import Subset
    train_loader = DataLoader(Subset(ds, train_idx), batch_size=args.batch_size, shuffle=True, collate_fn=collate)
    val_loader = DataLoader(Subset(ds, val_idx), batch_size=args.batch_size, collate_fn=collate)
    test_loader = DataLoader(Subset(ds, test_idx), batch_size=args.batch_size, collate_fn=collate)

    from vayu.ml.gcn_features import FEATURE_DIM
    model = STGNN(
        in_dim=FEATURE_DIM,
        hidden=args.hidden,
        forecast_horizon=args.forecast_hours,
        dropout=args.dropout,
    ).to(device)
    log.info(f'model: {sum(p.numel() for p in model.parameters()):,} params')

    if args.warm_start and Path(args.warm_start).exists():
        ckpt = torch.load(args.warm_start, map_location=device)
        try:
            sd = ckpt.get('model_state_dict', ckpt)
            model.load_state_dict(sd, strict=False)
            log.info(f'warm-start from {args.warm_start}')
        except Exception as e:
            log.warning(f'warm-start failed: {e}')

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None

    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment('breeva_stgcn')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    @torch.no_grad()
    def evaluate(loader):
        model.eval()
        total = 0.0
        count = 0
        for x, y, mask, edge_index, _ in loader:
            x = x.to(device)
            y = y.to(device)
            mask = mask.to(device)
            edge_index = edge_index.to(device)
            y_hat = model(x, edge_index)
            mu = y_hat[..., 0]
            err = ((mu - y).abs() * mask).sum().item()
            n = mask.sum().item()
            total += err
            count += n
        return total / max(count, 1)

    with mlflow.start_run(run_name=f'stgcn_v{timestamp}'):
        mlflow.log_params(vars(args))
        mlflow.log_param('feature_dim', FEATURE_DIM)
        mlflow.log_param('num_nodes', len(ds.nodes))
        mlflow.log_param('num_edges', ds.edge_index.shape[1])

        best_val = float('inf')
        patience = args.patience
        best_path = None
        for epoch in range(1, args.epochs + 1):
            model.train()
            t0 = time.time()
            ep_loss = 0.0
            n_seen = 0
            for x, y, mask, edge_index, _ in train_loader:
                x = x.to(device)
                y = y.to(device)
                mask = mask.to(device)
                edge_index = edge_index.to(device)
                optimizer.zero_grad()
                if scaler is not None:
                    with torch.amp.autocast('cuda', dtype=torch.float16):
                        y_hat = model(x, edge_index)
                        loss = masked_gaussian_nll_loss(y_hat, y, mask)
                    scaler.scale(loss).backward()
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    y_hat = model(x, edge_index)
                    loss = masked_gaussian_nll_loss(y_hat, y, mask)
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    optimizer.step()
                ep_loss += float(loss.item()) * float(mask.sum().item())
                n_seen += float(mask.sum().item())
            scheduler.step()
            val_mae = evaluate(val_loader)
            train_loss = ep_loss / max(n_seen, 1)
            mlflow.log_metrics({'train_loss': train_loss, 'val_mae': val_mae,
                                'lr': optimizer.param_groups[0]['lr']}, step=epoch)
            log.info(f'ep {epoch:3d} | loss {train_loss:.4f} | val MAE {val_mae:.3f} | {time.time()-t0:.1f}s')
            if val_mae < best_val - 0.05:
                best_val = val_mae
                patience = args.patience
                best_path = MODEL_DIR / f'stgcn_v{timestamp}_{args.tag}.pt'
                torch.save({
                    'model_state_dict': model.state_dict(),
                    'in_dim': FEATURE_DIM,
                    'hidden': args.hidden,
                    'forecast_horizon': args.forecast_hours,
                    'epoch': epoch,
                    'val_mae': val_mae,
                }, best_path)
                log.info(f'  -> checkpoint saved {best_path}')
            else:
                patience -= 1
                if patience == 0:
                    log.info('early stop')
                    break

        test_mae = evaluate(test_loader)
        mlflow.log_metric('test_mae', test_mae)
        log.info(f'test MAE {test_mae:.3f}')

        if best_path:
            mlflow.log_artifact(str(best_path))

    log.info(f'done. best val MAE: {best_val:.3f}')


if __name__ == '__main__':
    main()
