"""
Playbook §5.2 — Grid search for GraphSAGE hyperparameters.

Run ONLY if default config fails §1.1 gates. Spawns N training runs via
subprocess.Popen, each logged as separate MLflow run.

Run:
    python vayu/ml/hyperparameter_search.py --grid small
    python vayu/ml/hyperparameter_search.py --grid full --max-parallel 1
"""

from __future__ import annotations
import argparse
import itertools
import json
import logging
import subprocess
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('hp_search')

GRIDS = {
    'small': {
        'hidden': [64, 128],
        'lr': [1e-3, 3e-3],
        'lambda_smooth': [0.1, 0.2],
        'dropout': [0.2, 0.3],
    },
    'full': {
        'hidden': [32, 64, 128],
        'lr': [3e-4, 1e-3, 3e-3],
        'lambda_smooth': [0.05, 0.1, 0.2],
        'dropout': [0.15, 0.2, 0.3],
    },
}


def cartesian(grid: dict) -> list[dict]:
    keys = list(grid.keys())
    values = [grid[k] for k in keys]
    return [dict(zip(keys, combo)) for combo in itertools.product(*values)]


def run_one(combo: dict, epochs: int) -> dict:
    args = [
        sys.executable, 'vayu/ml/train_gcn.py',
        '--epochs', str(epochs),
        '--hidden', str(combo['hidden']),
        '--lr', str(combo['lr']),
        '--lambda-smooth', str(combo['lambda_smooth']),
        '--dropout', str(combo['dropout']),
    ]
    log.info(f'STARTING: {combo}')
    t0 = time.time()
    result = subprocess.run(args, capture_output=True, text=True, timeout=4 * 3600)
    dur = time.time() - t0
    # Parse "val MAE X.X" from stdout final lines
    val_mae = float('nan')
    for line in result.stdout.splitlines()[-50:]:
        if 'val MAE' in line or 'best val MAE' in line:
            try:
                val_mae = float(line.split('MAE')[-1].strip().split()[0])
            except Exception:
                pass
    log.info(f'DONE in {dur:.0f}s, val MAE={val_mae:.3f}')
    return {**combo, 'val_mae': val_mae, 'wall_s': dur, 'returncode': result.returncode}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--grid', choices=list(GRIDS), default='small')
    parser.add_argument('--epochs', type=int, default=40)
    parser.add_argument('--output', default='D:/breeva-ml-models/gcn/hp_search_results.json')
    args = parser.parse_args()

    combos = cartesian(GRIDS[args.grid])
    log.info(f'grid {args.grid}: {len(combos)} runs')
    results = []
    for combo in combos:
        try:
            results.append(run_one(combo, args.epochs))
        except subprocess.TimeoutExpired:
            log.error(f'  TIMEOUT {combo}')
            results.append({**combo, 'val_mae': float('nan'), 'returncode': -1})
        # Save incrementally
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(results, indent=2, default=str))

    valid = [r for r in results if not (r['val_mae'] != r['val_mae'])]
    if valid:
        best = min(valid, key=lambda r: r['val_mae'])
        log.info(f'BEST: {best}')


if __name__ == '__main__':
    main()
