"""
Tier 3 Phase 3.1.2 — PyG InMemoryDataset for the road graph.

Single graph (Indonesia 10 cities) loaded once. Each training "sample" = label
from prediction_logs joined to node by osm_way_id. Train/val/test mask via
spatial block hold-out (KMeans-based, prevents geographic leakage).
"""

from __future__ import annotations
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch_geometric.data import Data, InMemoryDataset

# Allow running as script or module
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_features import encode_node, FEATURE_DIM  # noqa: E402

log = logging.getLogger(__name__)


class RoadGraphDataset(InMemoryDataset):
    """Whole-graph PyG dataset.

    Args:
        root: directory containing nodes.parquet / edges.parquet / labels.parquet
        hour: hour of day to encode temporal features
        dow: day of week (0=Sun..6=Sat) for temporal features
        spatial_holdout_pct: fraction of clusters held out for val+test
        seed: numpy RNG seed
        target_col: 'residual_corrected' (Tier 4 Phase 4.0) or 'residual_caline'
    """

    def __init__(
        self,
        root: str = 'D:/breeva-ml-data/graph',
        hour: int = 12,
        dow: int = 1,
        spatial_holdout_pct: float = 0.2,
        seed: int = 42,
        target_col: str = 'residual_corrected',
    ):
        self.hour = hour
        self.dow = dow
        self.spatial_holdout_pct = spatial_holdout_pct
        self.seed = seed
        self.target_col = target_col
        super().__init__(root, transform=None, pre_transform=None, pre_filter=None)
        self.load(self.processed_paths[0])

    @property
    def raw_file_names(self):
        return ['nodes.parquet', 'edges.parquet', 'labels.parquet']

    @property
    def processed_file_names(self):
        return [f'data_h{self.hour}_dow{self.dow}_{self.target_col}.pt']

    def download(self):
        pass

    def process(self):
        nodes = pd.read_parquet(Path(self.root) / 'nodes.parquet')
        edges = pd.read_parquet(Path(self.root) / 'edges.parquet')
        labels = pd.read_parquet(Path(self.root) / 'labels.parquet')

        # 1) Node features
        log.info(f'encoding {len(nodes)} nodes...')
        x = np.stack([encode_node(row, self.hour, self.dow) for _, row in nodes.iterrows()])
        x = torch.from_numpy(x).float()

        # 2) osm_way_id → idx
        osm_to_idx = {wid: i for i, wid in enumerate(nodes['osm_way_id'].values)}

        # 3) edge_index
        log.info(f'building edge index from {len(edges)} edges...')
        valid = edges[edges['source_way'].isin(osm_to_idx) & edges['target_way'].isin(osm_to_idx)]
        src = valid['source_way'].map(osm_to_idx).values
        dst = valid['target_way'].map(osm_to_idx).values
        edge_index = torch.tensor(
            np.stack([np.concatenate([src, dst]), np.concatenate([dst, src])]),
            dtype=torch.long,
        )
        log.info(f'edge_index shape: {edge_index.shape}')

        # 4) targets — most recent label per osm_way_id
        y = torch.full((len(nodes),), float('nan'))
        if self.target_col not in labels.columns:
            raise ValueError(
                f'target_col {self.target_col!r} not in labels parquet; available: {list(labels.columns)}'
            )
        # take most recent per osm_way_id (predicted_at desc, dedupe)
        labels_sorted = labels.sort_values('predicted_at', ascending=False).drop_duplicates('osm_way_id')
        labeled_idx = []
        for _, lrow in labels_sorted.iterrows():
            wid = int(lrow['osm_way_id'])
            if wid in osm_to_idx:
                idx = osm_to_idx[wid]
                if torch.isnan(y[idx]):
                    y[idx] = float(lrow[self.target_col])
                    labeled_idx.append(idx)
        log.info(f'labeled {len(labeled_idx)} of {len(nodes)} nodes')

        # 5) spatial block hold-out via KMeans on (lng,lat) of LABELED nodes
        train_mask = torch.zeros(len(nodes), dtype=torch.bool)
        val_mask = torch.zeros(len(nodes), dtype=torch.bool)
        test_mask = torch.zeros(len(nodes), dtype=torch.bool)

        if len(labeled_idx) >= 20:
            from sklearn.cluster import KMeans
            labeled_coords = nodes.iloc[labeled_idx][['lng', 'lat']].values
            n_clusters = max(10, int(len(labeled_idx) * 0.05))
            km = KMeans(n_clusters=n_clusters, random_state=self.seed, n_init=10).fit(labeled_coords)
            cluster_ids = km.labels_

            rng = np.random.default_rng(self.seed)
            holdout_clusters = rng.choice(
                n_clusters, size=int(n_clusters * self.spatial_holdout_pct), replace=False
            )
            val_test_clusters = set(int(c) for c in holdout_clusters)
            val_pool = rng.choice(list(val_test_clusters), size=max(1, len(val_test_clusters) // 2), replace=False)
            val_clusters = set(int(c) for c in val_pool)

            for k, idx in enumerate(labeled_idx):
                cid = int(cluster_ids[k])
                if cid in val_clusters:
                    val_mask[idx] = True
                elif cid in val_test_clusters:
                    test_mask[idx] = True
                else:
                    train_mask[idx] = True
        else:
            log.warning(
                f'too few labels ({len(labeled_idx)}) — splitting random 60/20/20 for whatever is available'
            )
            rng = np.random.default_rng(self.seed)
            perm = rng.permutation(labeled_idx)
            n_train = int(len(perm) * 0.6)
            n_val = int(len(perm) * 0.2)
            for i, idx in enumerate(perm):
                if i < n_train:
                    train_mask[idx] = True
                elif i < n_train + n_val:
                    val_mask[idx] = True
                else:
                    test_mask[idx] = True

        log.info(
            f'split: train={int(train_mask.sum())} val={int(val_mask.sum())} test={int(test_mask.sum())}'
        )

        data = Data(
            x=x,
            edge_index=edge_index,
            y=y,
            train_mask=train_mask,
            val_mask=val_mask,
            test_mask=test_mask,
            osm_way_ids=torch.tensor(nodes['osm_way_id'].values, dtype=torch.long),
        )
        self.save([data], self.processed_paths[0])


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    ds = RoadGraphDataset()
    d = ds[0]
    print(d)
    print(f'feature_dim: {d.x.shape[1]} (expected {FEATURE_DIM})')
    print(f'train/val/test: {int(d.train_mask.sum())}/{int(d.val_mask.sum())}/{int(d.test_mask.sum())}')
