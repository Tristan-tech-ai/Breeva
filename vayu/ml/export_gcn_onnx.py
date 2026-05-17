"""
Tier 3 Phase 3.4.1 — Export trained GraphSAGE → ONNX for inference deployment.

Note: PyG SAGEConv ONNX export needs fixed graph size OR dynamic axes.
For Tier 3 we precompute all predictions overnight (precompute_gcn.py), so ONNX
runs in Python (not Vercel); Vercel only fetches from cache table.

Run:
    python vayu/ml/export_gcn_onnx.py \
      --model-path D:/breeva-ml-models/gcn/gcn_road_v20260530_120000.pt \
      --output D:/breeva-ml-models/gcn/gcn_road_v20260530.onnx
"""

from __future__ import annotations
import argparse
import logging
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from vayu.ml.gcn_model import RoadGraphSAGE  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('export_onnx')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-path', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--opset', type=int, default=17)
    args = parser.parse_args()

    ckpt = torch.load(args.model_path, map_location='cpu')
    model = RoadGraphSAGE(
        in_dim=ckpt['in_dim'],
        hidden=ckpt['hidden'],
        n_layers=ckpt.get('n_layers', 3),
        dropout=ckpt.get('dropout', 0.2),
    )
    model.load_state_dict(ckpt['model_state_dict'])
    model.eval()

    n_nodes = 100
    dummy_x = torch.randn(n_nodes, ckpt['in_dim'])
    dummy_edge = torch.randint(0, n_nodes, (2, 500))

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        (dummy_x, dummy_edge),
        str(out),
        input_names=['x', 'edge_index'],
        output_names=['residual', 'uncertainty'],
        dynamic_axes={
            'x': {0: 'num_nodes'},
            'edge_index': {1: 'num_edges'},
            'residual': {0: 'num_nodes'},
            'uncertainty': {0: 'num_nodes'},
        },
        opset_version=args.opset,
        do_constant_folding=True,
    )
    size_mb = out.stat().st_size / 1e6
    log.info(f'exported {out} ({size_mb:.2f} MB)')


if __name__ == '__main__':
    main()
