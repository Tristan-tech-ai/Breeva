"""
Tier 4 Phase 4.4 — Temporal dataset for ST-GNN training.

Each sample = (x_past [N, history_hours, F], y_future [N, forecast_hours],
              mask [N, forecast_hours]).

Anchor sampling: prefer labeled timestamps where >= min_labeled_pct of roads
have a ground_truth_pm25 within +/- forecast_hours.

NOTE: This reads parquet exports produced by export_graph_snapshot.py PLUS
a temporal slice from prediction_logs (joined with ground_truth_pm25). For the
initial implementation we use a simple lag/lead build with the latest snapshot
features held constant across time — full temporal features will be added when
we extend the export to emit per-hour parquet files.
"""

from __future__ import annotations
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

log = logging.getLogger(__name__)


class STGNNDataset(Dataset):
    def __init__(
        self,
        graph_root: str,
        history_hours: int = 24,
        forecast_hours: int = 24,
        stride_hours: int = 6,
        min_labeled_pct: float = 0.10,
    ):
        super().__init__()
        self.graph_root = Path(graph_root)
        self.history_hours = history_hours
        self.forecast_hours = forecast_hours
        self.stride_hours = stride_hours
        self.min_labeled_pct = min_labeled_pct

        self.nodes = pd.read_parquet(self.graph_root / 'nodes.parquet')
        self.edges = pd.read_parquet(self.graph_root / 'edges.parquet')
        self.labels = pd.read_parquet(self.graph_root / 'labels.parquet')

        osm_to_idx = {wid: i for i, wid in enumerate(self.nodes['osm_way_id'].values)}
        valid = self.edges[
            self.edges['source_way'].isin(osm_to_idx)
            & self.edges['target_way'].isin(osm_to_idx)
        ]
        src = valid['source_way'].map(osm_to_idx).values
        dst = valid['target_way'].map(osm_to_idx).values
        self.edge_index = torch.tensor(
            np.stack([np.concatenate([src, dst]), np.concatenate([dst, src])]),
            dtype=torch.long,
        )
        self.osm_to_idx = osm_to_idx

        self.labels = self.labels.copy()
        self.labels['predicted_at'] = pd.to_datetime(self.labels['predicted_at'])
        self.labels = self.labels.sort_values('predicted_at')

        self.anchors = self._build_anchors()
        log.info(f'STGNNDataset: {len(self.nodes)} nodes, {len(self.anchors)} anchors')

    def _build_anchors(self) -> list[pd.Timestamp]:
        if len(self.labels) == 0:
            return []
        start = self.labels['predicted_at'].min().floor('h')
        end = self.labels['predicted_at'].max().ceil('h')
        candidate = pd.date_range(start, end, freq=f'{self.stride_hours}h')
        anchors: list[pd.Timestamp] = []
        threshold = self.min_labeled_pct * len(self.nodes)
        for ts in candidate:
            window_start = ts
            window_end = ts + pd.Timedelta(hours=self.forecast_hours)
            window = self.labels[
                (self.labels['predicted_at'] >= window_start)
                & (self.labels['predicted_at'] < window_end)
            ]
            if window['osm_way_id'].nunique() >= threshold:
                anchors.append(ts)
        return anchors

    def __len__(self) -> int:
        return len(self.anchors)

    def __getitem__(self, idx: int):
        from vayu.ml.gcn_features import encode_node
        anchor = self.anchors[idx]

        # Past window: replay snapshot features for history_hours, varying hour-of-day only
        x_history = []
        for offset in range(-self.history_hours, 0):
            hour = (anchor + pd.Timedelta(hours=offset)).hour
            dow = (anchor + pd.Timedelta(hours=offset)).dayofweek
            feats = np.stack([encode_node(row, hour, dow) for _, row in self.nodes.iterrows()])
            x_history.append(feats)
        x_past = torch.from_numpy(np.stack(x_history, axis=1)).float()  # [N, T, F]

        # Future targets + mask
        y_future = torch.full((len(self.nodes), self.forecast_hours), float('nan'))
        mask = torch.zeros((len(self.nodes), self.forecast_hours))
        for h in range(self.forecast_hours):
            window_start = anchor + pd.Timedelta(hours=h)
            window_end = anchor + pd.Timedelta(hours=h + 1)
            window = self.labels[
                (self.labels['predicted_at'] >= window_start)
                & (self.labels['predicted_at'] < window_end)
            ]
            if window.empty:
                continue
            for _, lrow in window.iterrows():
                wid = int(lrow['osm_way_id'])
                if wid in self.osm_to_idx:
                    i = self.osm_to_idx[wid]
                    y_future[i, h] = float(lrow.get('residual_corrected', lrow.get('ground_truth_pm25')))
                    mask[i, h] = 1.0

        return x_past, y_future, mask, self.edge_index, anchor.isoformat()
