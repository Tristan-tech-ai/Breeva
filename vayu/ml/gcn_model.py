"""
Tier 3 Phase 3.2.1 — GraphSAGE model for road-level PM2.5 residual prediction.

Why GraphSAGE: scalable to large graphs via neighbor sampling, inductive
(works on unseen nodes — important for newly-added regions), simpler than GAT
so ONNX export stays clean.

Output: 2 heads
  - residual_pm25_delta (regression)
  - uncertainty_sigma (softplus for positivity, floor 0.1)
"""

from __future__ import annotations
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv


class RoadGraphSAGE(nn.Module):
    def __init__(
        self,
        in_dim: int = 53,
        hidden: int = 64,
        n_layers: int = 3,
        dropout: float = 0.2,
        aggregator: str = 'mean',
    ):
        super().__init__()
        self.in_dim = in_dim
        self.hidden = hidden
        self.n_layers = n_layers
        self.dropout = dropout

        self.convs = nn.ModuleList()
        self.bns = nn.ModuleList()
        for i in range(n_layers):
            in_c = in_dim if i == 0 else hidden
            self.convs.append(SAGEConv(in_c, hidden, aggr=aggregator))
            self.bns.append(nn.BatchNorm1d(hidden))

        self.head_residual = nn.Linear(hidden, 1)
        self.head_uncertainty = nn.Linear(hidden, 1)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = x
        for i, (conv, bn) in enumerate(zip(self.convs, self.bns)):
            h = conv(h, edge_index)
            h = bn(h)
            h = F.relu(h)
            if i < self.n_layers - 1:
                h = F.dropout(h, p=self.dropout, training=self.training)

        residual = self.head_residual(h).squeeze(-1)
        # softplus floor 0.1 → predicted sigma never collapses to 0 (loss stability)
        uncertainty = F.softplus(self.head_uncertainty(h).squeeze(-1)) + 0.1
        return residual, uncertainty

    def reset_parameters(self):
        for c in self.convs:
            c.reset_parameters()
        for b in self.bns:
            b.reset_parameters()
        self.head_residual.reset_parameters()
        self.head_uncertainty.reset_parameters()
