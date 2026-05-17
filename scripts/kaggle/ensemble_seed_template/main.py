"""
Playbook §5.5 — Kaggle ensemble seed kernel template.

Per Tier 4 Phase 4.3: each seed = one Kaggle kernel. 5 kernels across 3 accounts
gives 5 ensemble members in parallel.

Setup:
1. Upload D:/breeva-ml-data/graph/{nodes,edges,labels}.parquet as Kaggle Dataset
   "breeva-graph-snapshot" via kg.sh datasets create
2. Duplicate this folder per seed (ensemble_seed_1/, ensemble_seed_2/, ...)
3. Edit each kernel-metadata.json: replace PLACEHOLDER_USERNAME, set seed-specific ID
4. Set SEED env var (or hard-code below) per kernel
5. Push: bash scripts/kaggle/kg.sh <account> kernels push -p scripts/kaggle/ensemble_seed_N/
6. After all complete: download outputs locally:
     bash scripts/kaggle/kg.sh <account> kernels output <username/kernel> -p D:/breeva-ml-models/gcn/
7. Build ensemble manifest pointing to all 5 .pt files
8. Run vayu/ml/ensemble_predict.py --manifest <manifest.json>
"""

import os
import sys
import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv
from torch_geometric.data import Data
from torch_geometric.loader import NeighborLoader

# ─────────── Config (edit per seed) ───────────
SEED = int(os.environ.get('SEED', 1))
EPOCHS = int(os.environ.get('EPOCHS', 60))
HIDDEN = int(os.environ.get('HIDDEN', 64))
LR = float(os.environ.get('LR', 1e-3))
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', 4096))
LAMBDA_SMOOTH = float(os.environ.get('LAMBDA_SMOOTH', 0.1))

DATA_ROOT = Path('/kaggle/input/breeva-graph-snapshot')
OUTPUT_DIR = Path('/kaggle/working')
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

torch.manual_seed(SEED)
np.random.seed(SEED)
print(f'[seed {SEED}] device={torch.cuda.get_device_name() if torch.cuda.is_available() else "cpu"}')


# ─────────── Model (mirror vayu/ml/gcn_model.py) ───────────
class RoadGraphSAGE(nn.Module):
    def __init__(self, in_dim: int, hidden: int = 64, n_layers: int = 3, dropout: float = 0.2):
        super().__init__()
        self.in_dim = in_dim
        self.hidden = hidden
        self.n_layers = n_layers
        self.dropout = dropout
        self.convs = nn.ModuleList()
        self.bns = nn.ModuleList()
        for i in range(n_layers):
            in_c = in_dim if i == 0 else hidden
            self.convs.append(SAGEConv(in_c, hidden, aggr='mean'))
            self.bns.append(nn.BatchNorm1d(hidden))
        self.head_residual = nn.Linear(hidden, 1)
        self.head_uncertainty = nn.Linear(hidden, 1)

    def forward(self, x, edge_index):
        h = x
        for i, (conv, bn) in enumerate(zip(self.convs, self.bns)):
            h = conv(h, edge_index)
            h = bn(h)
            h = F.relu(h)
            if i < self.n_layers - 1:
                h = F.dropout(h, p=self.dropout, training=self.training)
        residual = self.head_residual(h).squeeze(-1)
        uncertainty = F.softplus(self.head_uncertainty(h).squeeze(-1)) + 0.1
        return residual, uncertainty


# ─────────── Feature encoder (mirror gcn_features.py 53-dim) ───────────
HIGHWAY_CLASSES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
                   'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
                   'residential', 'living_street', 'service', 'pedestrian', 'footway']
LANDUSE_CLASSES = ['commercial', 'industrial', 'residential', 'park', 'mixed', 'suburban']
SURFACE_CLASSES = ['asphalt', 'concrete', 'paved', 'unpaved', 'cobblestone']
REGIONS = ['jakarta', 'bali', 'bandung', 'surabaya', 'semarang',
           'yogyakarta', 'solo', 'medan', 'palembang', 'makassar']
FEATURE_DIM = 16 + 6 + 5 + 10 + 12 + 4


def one_hot(value, classes):
    arr = np.zeros(len(classes), dtype=np.float32)
    if value in classes:
        arr[classes.index(value)] = 1.0
    return arr


def safe_float(v, default=0.0):
    try:
        f = float(v)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def encode_node(row, hour=12, dow=1):
    return np.concatenate([
        one_hot(row.get('highway'), HIGHWAY_CLASSES),
        one_hot(row.get('landuse_proxy'), LANDUSE_CLASSES),
        one_hot(row.get('surface'), SURFACE_CLASSES),
        one_hot(row.get('region'), REGIONS),
        np.array([
            np.log1p(safe_float(row.get('lanes'), 1)),
            np.log1p(safe_float(row.get('width'), 6)),
            np.log1p(safe_float(row.get('maxspeed'), 40)),
            safe_float(row.get('canyon_ratio'), 0.3),
            np.log1p(safe_float(row.get('elevation_avg'), 50) + 100) - np.log(100),
            np.log1p(safe_float(row.get('traffic_base_estimate'), 100)),
            safe_float(row.get('traffic_calibration_factor'), 1.0),
            safe_float(row.get('ai_pollution_factor'), 1.0),
            float(bool(row.get('ai_classified', False))),
            (safe_float(row.get('lng'), 110.0) - 110.0) / 30.0,
            (safe_float(row.get('lat'), -3.0) - (-3.0)) / 8.0,
            np.log1p(safe_float(row.get('length_m'), 100)),
            np.sin(2 * np.pi * hour / 24),
            np.cos(2 * np.pi * hour / 24),
            np.sin(2 * np.pi * dow / 7),
            np.cos(2 * np.pi * dow / 7),
        ], dtype=np.float32),
    ])


# ─────────── Build graph ───────────
print(f'[seed {SEED}] loading parquet...')
nodes = pd.read_parquet(DATA_ROOT / 'nodes.parquet')
edges = pd.read_parquet(DATA_ROOT / 'edges.parquet')
labels = pd.read_parquet(DATA_ROOT / 'labels.parquet')
print(f'[seed {SEED}] nodes={len(nodes)} edges={len(edges)} labels={len(labels)}')

print(f'[seed {SEED}] encoding features...')
x = np.stack([encode_node(row) for _, row in nodes.iterrows()])
x = torch.from_numpy(x).float()

osm_to_idx = {wid: i for i, wid in enumerate(nodes['osm_way_id'].values)}
valid = edges[edges['source_way'].isin(osm_to_idx) & edges['target_way'].isin(osm_to_idx)]
src = valid['source_way'].map(osm_to_idx).values
dst = valid['target_way'].map(osm_to_idx).values
edge_index = torch.tensor(np.stack([np.concatenate([src, dst]), np.concatenate([dst, src])]), dtype=torch.long)

y = torch.full((len(nodes),), float('nan'))
labels_sorted = labels.sort_values('predicted_at', ascending=False).drop_duplicates('osm_way_id')
labeled_idx = []
for _, lrow in labels_sorted.iterrows():
    wid = int(lrow['osm_way_id'])
    if wid in osm_to_idx and torch.isnan(y[osm_to_idx[wid]]):
        y[osm_to_idx[wid]] = float(lrow.get('residual_corrected', lrow.get('ground_truth_pm25', 0)))
        labeled_idx.append(osm_to_idx[wid])

rng = np.random.default_rng(SEED)
perm = rng.permutation(labeled_idx)
n_train = int(len(perm) * 0.7)
n_val = int(len(perm) * 0.15)
train_mask = torch.zeros(len(nodes), dtype=torch.bool)
val_mask = torch.zeros(len(nodes), dtype=torch.bool)
test_mask = torch.zeros(len(nodes), dtype=torch.bool)
for i, idx in enumerate(perm):
    if i < n_train: train_mask[idx] = True
    elif i < n_train + n_val: val_mask[idx] = True
    else: test_mask[idx] = True

data = Data(x=x, edge_index=edge_index, y=y, train_mask=train_mask, val_mask=val_mask, test_mask=test_mask)
print(f'[seed {SEED}] split train={int(train_mask.sum())} val={int(val_mask.sum())} test={int(test_mask.sum())}')

# ─────────── Train ───────────
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = RoadGraphSAGE(in_dim=FEATURE_DIM, hidden=HIDDEN).to(device)
optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-5)
scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)
train_loader = NeighborLoader(data, num_neighbors=[25, 10, 10], batch_size=BATCH_SIZE,
                              input_nodes=data.train_mask, shuffle=True)

def gaussian_nll(pred, target, sigma):
    var = sigma ** 2
    return 0.5 * (torch.log(var) + ((pred - target) ** 2) / var).mean()

best_val = float('inf')
for epoch in range(1, EPOCHS + 1):
    model.train()
    t0 = time.time()
    total, count = 0, 0
    for batch in train_loader:
        batch = batch.to(device)
        optimizer.zero_grad()
        residual, sigma = model(batch.x, batch.edge_index)
        mask = batch.train_mask[:batch.batch_size]
        if mask.sum() == 0: continue
        target = batch.y[:batch.batch_size][mask]
        pred = residual[:batch.batch_size][mask]
        s = sigma[:batch.batch_size][mask]
        loss_data = gaussian_nll(pred, target, s)
        src_b, dst_b = batch.edge_index[0], batch.edge_index[1]
        smooth = (residual[src_b] - residual[dst_b]).pow(2).mean()
        loss = loss_data + LAMBDA_SMOOTH * smooth
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        total += loss.item() * mask.sum().item()
        count += mask.sum().item()
    scheduler.step()
    avg_loss = total / max(count, 1)
    # val
    model.eval()
    with torch.no_grad():
        d = data.to(device)
        r, _ = model(d.x, d.edge_index)
        val_mae = float((r[d.val_mask] - d.y[d.val_mask]).abs().mean())
    if val_mae < best_val - 0.05:
        best_val = val_mae
        torch.save({
            'model_state_dict': model.state_dict(),
            'in_dim': FEATURE_DIM, 'hidden': HIDDEN, 'n_layers': 3, 'dropout': 0.2,
            'seed': SEED, 'epoch': epoch, 'val_mae': val_mae,
        }, OUTPUT_DIR / f'ensemble_seed{SEED}.pt')
    print(f'[seed {SEED}] ep {epoch:3d} | loss {avg_loss:.4f} | val MAE {val_mae:.3f} | {time.time()-t0:.1f}s')

# ─────────── Output manifest fragment ───────────
metrics = {'seed': SEED, 'best_val_mae': best_val, 'epochs_run': epoch}
(OUTPUT_DIR / f'metrics_seed{SEED}.json').write_text(json.dumps(metrics, indent=2))
print(f'[seed {SEED}] done. best val MAE: {best_val:.3f}')
