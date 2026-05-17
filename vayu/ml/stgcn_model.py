"""
Tier 4 Phase 4.4 — Spatio-Temporal GraphSAGE (ST-GNN) for 24h per-road PM2.5
forecasting.

Replaces both Tier 2.2 LSTM (cell-level) and Tier 3 snapshot GraphSAGE with a
single model that learns spatial + temporal patterns jointly.

Architecture:
  1. Spatial encoder: SAGEConv per timestep (shared weights across T)
     x[:,t,:] -> h_spatial[:,t,:hidden]
  2. Temporal encoder: 1-layer GRU per node along time axis
     h_spatial -> h_temporal[:,t,:hidden]
  3. Spatial refinement: SAGEConv on last hidden state
  4. Forecast head: H * 2 outputs (mu, log_sigma per forecast hour)
"""

from __future__ import annotations
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv, BatchNorm


class STGNN(nn.Module):
    def __init__(
        self,
        in_dim: int = 63,
        hidden: int = 64,
        n_spatial_layers: int = 2,
        forecast_horizon: int = 24,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.in_dim = in_dim
        self.hidden = hidden
        self.n_spatial_layers = n_spatial_layers
        self.forecast_horizon = forecast_horizon
        self.dropout = dropout

        # Spatial conv stack (per-timestep, shared across T)
        self.spatial_in = SAGEConv(in_dim, hidden, normalize=True)
        self.spatial_mid = nn.ModuleList([
            SAGEConv(hidden, hidden, normalize=True)
            for _ in range(max(0, n_spatial_layers - 1))
        ])
        self.bn_spatial = BatchNorm(hidden)

        # Temporal GRU
        self.gru = nn.GRU(hidden, hidden, batch_first=True, num_layers=1)
        self.ln_temporal = nn.LayerNorm(hidden)

        # Final spatial refinement on last hidden state
        self.spatial_out = SAGEConv(hidden, hidden, normalize=True)

        # Forecast head: per-hour (mu, log_sigma)
        self.head = nn.Sequential(
            nn.Linear(hidden, hidden),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, forecast_horizon * 2),
        )

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        """
        x:           [N, T, F]
        edge_index:  [2, E]
        returns:     [N, H, 2]  channels = (mu, log_sigma)
        """
        N, T, _ = x.shape

        # Spatial conv per timestep (shared weights)
        h_steps = []
        for t in range(T):
            h = self.spatial_in(x[:, t, :], edge_index)
            h = F.relu(h)
            for layer in self.spatial_mid:
                h = F.relu(layer(h, edge_index))
            h_steps.append(h)
        h_spatial = torch.stack(h_steps, dim=1)  # [N, T, hidden]
        flat = self.bn_spatial(h_spatial.reshape(-1, h_spatial.shape[-1]))
        h_spatial = flat.view(N, T, -1)

        # Temporal GRU
        h_temp, _ = self.gru(h_spatial)              # [N, T, hidden]
        h_last = self.ln_temporal(h_temp[:, -1, :])  # [N, hidden]

        # Spatial refinement on last hidden state
        h_out = F.relu(self.spatial_out(h_last, edge_index))

        # Forecast head -> [N, H*2] -> [N, H, 2]
        y_hat = self.head(h_out)
        return y_hat.view(N, self.forecast_horizon, 2)


def masked_gaussian_nll_loss(
    y_hat: torch.Tensor,
    y_true: torch.Tensor,
    mask: torch.Tensor,
    eps: float = 1e-3,
) -> torch.Tensor:
    """Loss is averaged over labeled hours only (mask = 1 where ground truth exists)."""
    mu = y_hat[..., 0]
    log_sigma = y_hat[..., 1]
    sigma = F.softplus(log_sigma) + eps
    nll = 0.5 * torch.log(2 * torch.pi * sigma ** 2) + 0.5 * ((y_true - mu) / sigma) ** 2
    masked = nll * mask
    denom = mask.sum().clamp(min=1)
    return masked.sum() / denom
