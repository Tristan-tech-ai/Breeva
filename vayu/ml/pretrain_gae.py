"""
Playbook §7.4 — Graph autoencoder (GAE) self-supervised pretraining.

Unsupervised: learn node embeddings via edge-reconstruction loss on graph
topology alone (no PM2.5 labels needed). Output: encoder checkpoint that
warm-starts GraphSAGE finetuning when labels eventually arrive.

Use case: cold-start new region (no labels for days), or as Tier 5 unsupervised
representation learning baseline.

Run:
    python vayu/ml/pretrain_gae.py --epochs 30
    python vayu/ml/pretrain_gae.py --region balikpapan --epochs 50
"""

from __future__ import annotations
import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GAE, SAGEConv

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_dataset import RoadGraphDataset  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('pretrain_gae')

MODEL_DIR = Path('D:/breeva-ml-models/gae/')


class SAGEEncoder(nn.Module):
    def __init__(self, in_dim: int, hidden: int = 64, n_layers: int = 3):
        super().__init__()
        self.convs = nn.ModuleList()
        for i in range(n_layers):
            in_c = in_dim if i == 0 else hidden
            out_c = hidden
            self.convs.append(SAGEConv(in_c, out_c))

    def forward(self, x, edge_index):
        h = x
        for i, conv in enumerate(self.convs):
            h = conv(h, edge_index)
            if i < len(self.convs) - 1:
                h = F.relu(h)
        return h


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--hidden', type=int, default=64)
    parser.add_argument('--n-layers', type=int, default=3)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--region', default=None,
                        help='Optional: filter to one region (cold-start scenario)')
    parser.add_argument('--data-root', default='D:/breeva-ml-data/graph/')
    args = parser.parse_args()

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log.info(f'device: {device}')

    # Reuse RoadGraphDataset (it doesn't require labels for forward pass)
    ds = RoadGraphDataset(root=args.data_root)
    data = ds[0]
    log.info(f'graph: {data.num_nodes} nodes, {data.edge_index.shape[1]} edges')

    if args.region is not None:
        # crude region filter: subset by checking nodes parquet
        import pandas as pd
        nodes = pd.read_parquet(Path(args.data_root) / 'nodes.parquet')
        mask = nodes['region'].values == args.region
        if mask.sum() == 0:
            log.error(f'no nodes for region {args.region}')
            sys.exit(2)
        idx = torch.from_numpy(mask).nonzero(as_tuple=True)[0]
        # reindex
        keep = set(int(i) for i in idx)
        edge_mask = torch.tensor([
            (int(s) in keep) and (int(t) in keep)
            for s, t in zip(data.edge_index[0], data.edge_index[1])
        ])
        data.x = data.x[idx]
        data.edge_index = data.edge_index[:, edge_mask]
        log.info(f'region {args.region}: {data.num_nodes} nodes after filter (edges {data.edge_index.shape[1]})')

    encoder = SAGEEncoder(in_dim=data.x.shape[1], hidden=args.hidden, n_layers=args.n_layers).to(device)
    model = GAE(encoder).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)

    data = data.to(device)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    region_tag = args.region if args.region else 'all'
    out_path = MODEL_DIR / f'gae_{region_tag}_v{timestamp}.pt'

    log.info('starting unsupervised edge-reconstruction training')
    for epoch in range(1, args.epochs + 1):
        model.train()
        optimizer.zero_grad()
        z = model.encode(data.x, data.edge_index)
        loss = model.recon_loss(z, data.edge_index)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        if epoch % 5 == 0 or epoch == args.epochs:
            log.info(f'ep {epoch:3d} | recon_loss {loss.item():.4f}')

    torch.save({
        'encoder_state_dict': encoder.state_dict(),
        'in_dim': data.x.shape[1],
        'hidden': args.hidden,
        'n_layers': args.n_layers,
        'region': region_tag,
        'epoch': args.epochs,
    }, out_path)
    log.info(f'saved encoder: {out_path}')


if __name__ == '__main__':
    main()
