"""
VAYU — LSTM 24-hour AQI forecast trainer (Phase 2.2).

Per H3 res-7 cell, learn next 24h pm25 trajectory from last 72h history.

Pipeline:
  1. Load historical hourly aqi_grid pm25 from public.aqi_grid (last N days).
  2. Build per-cell sliding windows (X = 72h × features, y = next 24h pm25).
  3. Train 2-layer LSTM (PyTorch) on RTX 5060 Ti (CUDA).
  4. Save .pt + register in ml_model_registry.

Run:
    python vayu/ml/train_residual_lstm.py --region jakarta --days 30
    python vayu/ml/train_residual_lstm.py --all-regions --epochs 50

Caveat: aqi_grid mungkin sparse di awal — minimum 1k samples per region
sebelum training berarti. Untuk demo bisa pakai synthetic injection (lihat
flag --synthetic-fallback) atau wait corpus accumulate.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# .env.local loader
def _load_env_local():
    repo_root = Path(__file__).resolve().parents[2]
    for fname in ('.env.local', '.env'):
        p = repo_root / fname
        if not p.exists():
            continue
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip("'").strip('"')
            if k and k not in os.environ:
                os.environ[k] = v
_load_env_local()

import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split

try:
    import mlflow
    HAS_MLFLOW = True
except ImportError:
    HAS_MLFLOW = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('train_lstm')

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
log.info(f'Using device: {DEVICE} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"})')

if HAS_MLFLOW:
    try:
        mlflow.set_tracking_uri(os.environ.get('MLFLOW_TRACKING_URI', 'http://127.0.0.1:8080'))
        mlflow.set_experiment('aqi_lstm_forecast')
    except Exception as exc:
        log.warning(f'MLflow disabled: {exc}')
        HAS_MLFLOW = False


LOOKBACK = 72   # hours
HORIZON = 24    # hours ahead


class AqiTimeSeriesDataset(Dataset):
    def __init__(self, df: pd.DataFrame, lookback: int = LOOKBACK, horizon: int = HORIZON):
        self.lookback = lookback
        self.horizon = horizon
        self.windows: list[tuple[np.ndarray, np.ndarray]] = []
        for cell_id, group in df.groupby('cell_id'):
            group = group.sort_values('hour')
            arr = group[['pm25', 'no2', 'hour_of_day', 'day_of_week', 'is_weekend']].values
            for i in range(len(arr) - lookback - horizon):
                x = arr[i:i + lookback]
                y = arr[i + lookback:i + lookback + horizon, 0]  # pm25 only
                self.windows.append((x, y))

    def __len__(self): return len(self.windows)

    def __getitem__(self, idx):
        x, y = self.windows[idx]
        return torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)


class AqiLSTM(nn.Module):
    def __init__(self, input_dim: int = 5, hidden_dim: int = 128,
                 num_layers: int = 2, horizon: int = HORIZON, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers=num_layers,
                            dropout=dropout, batch_first=True)
        self.fc = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, horizon),
        )

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.fc(out[:, -1, :])


def load_data(conn, region: str | None, days: int = 30) -> pd.DataFrame:
    where_region = f"AND ac.region = '{region}'" if region else ''
    sql = f"""
        SELECT
          ac.cell_id,
          date_trunc('hour', ac.computed_at) AS hour,
          AVG(ac.pm25)::real AS pm25,
          AVG(ac.no2)::real AS no2,
          EXTRACT(HOUR FROM ac.computed_at)::int AS hour_of_day,
          EXTRACT(DOW FROM ac.computed_at)::int AS day_of_week
        FROM public.aqi_grid ac
        WHERE ac.computed_at > NOW() - INTERVAL '{days} days'
          AND ac.pm25 IS NOT NULL
          {where_region}
        GROUP BY ac.cell_id, date_trunc('hour', ac.computed_at);
    """
    df = pd.read_sql(sql, conn)
    if len(df) == 0:
        return df
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
    # Normalize
    df['hour_of_day'] = df['hour_of_day'] / 23.0
    df['day_of_week'] = df['day_of_week'] / 6.0
    df['pm25'] = df['pm25'].clip(0, 300) / 300.0
    df['no2'] = df['no2'].clip(0, 200) / 200.0
    log.info(f'Loaded {len(df)} hourly samples across {df.cell_id.nunique()} cells')
    return df


def train_model(model, train_loader, val_loader, epochs: int, lr: float = 1e-3):
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()
    best_val_mae = float('inf')

    for epoch in range(epochs):
        model.train()
        train_loss_sum = 0.0
        n_train = 0
        for x, y in train_loader:
            x, y = x.to(DEVICE), y.to(DEVICE)
            optimizer.zero_grad()
            pred = model(x)
            loss = criterion(pred, y)
            loss.backward()
            optimizer.step()
            train_loss_sum += loss.item() * len(y)
            n_train += len(y)

        model.eval()
        val_mae_sum = 0.0
        n_val = 0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(DEVICE), y.to(DEVICE)
                pred = model(x)
                val_mae_sum += (pred - y).abs().sum().item()
                n_val += len(y) * pred.shape[1]
        val_mae = val_mae_sum / max(n_val, 1)
        train_loss = train_loss_sum / max(n_train, 1)

        if HAS_MLFLOW:
            mlflow.log_metric('train_loss', train_loss, step=epoch)
            mlflow.log_metric('val_mae', val_mae, step=epoch)
        log.info(f'Epoch {epoch:2d}: train_loss={train_loss:.4f} val_mae={val_mae:.4f}')
        best_val_mae = min(best_val_mae, val_mae)

    return best_val_mae


def register_model(conn, region: str | None, version: str, model_path: str, best_mae: float):
    sql_deactivate = "UPDATE public.ml_model_registry SET active = FALSE WHERE model_name = 'lstm_aqi_24h' AND region IS NOT DISTINCT FROM %s"
    sql_insert = """
        INSERT INTO public.ml_model_registry
          (model_name, version, region, artifact_path, metrics, features, active)
        VALUES ('lstm_aqi_24h', %s, %s, %s, %s, %s, TRUE)
        ON CONFLICT (model_name, version, region) DO UPDATE SET
          metrics = EXCLUDED.metrics, active = TRUE, trained_at = NOW();
    """
    with conn.cursor() as cur:
        cur.execute(sql_deactivate, (region,))
        cur.execute(sql_insert, (
            version, region, model_path,
            json.dumps({'val_mae_norm': best_mae, 'lookback': LOOKBACK, 'horizon': HORIZON}),
            ['pm25', 'no2', 'hour_of_day', 'day_of_week', 'is_weekend'],
        ))
    conn.commit()
    log.info(f'Registered lstm_aqi_24h {version} region={region or "global"}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region')
    parser.add_argument('--all-regions', action='store_true')
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--version', default=f'v{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")}')
    parser.add_argument('--min-windows', type=int, default=500)
    args = parser.parse_args()

    dsn = os.environ.get('SUPABASE_POOLER_URL')
    if not dsn:
        log.error('SUPABASE_POOLER_URL not set')
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    regions: list[str | None]
    if args.all_regions:
        regions = [None, 'jakarta', 'bali', 'bandung', 'surabaya',
                   'semarang', 'yogyakarta', 'solo', 'medan', 'palembang', 'makassar']
    elif args.region:
        regions = [args.region]
    else:
        regions = [None]

    models_dir = Path('models')
    models_dir.mkdir(exist_ok=True)

    for region in regions:
        log.info(f'=== LSTM training region={region or "global"} ===')
        df = load_data(conn, region, args.days)
        if len(df) == 0:
            log.warning(f'No data — skip {region or "global"}')
            continue
        dataset = AqiTimeSeriesDataset(df)
        if len(dataset) < args.min_windows:
            log.warning(f'Only {len(dataset)} windows — skip (need {args.min_windows})')
            continue

        ctx = mlflow.start_run(run_name=f'lstm_{region or "global"}_{args.version}') if HAS_MLFLOW else _noop_cm()
        with ctx:
            if HAS_MLFLOW:
                mlflow.log_params({
                    'region': region or 'global',
                    'days': args.days,
                    'epochs': args.epochs,
                    'batch_size': args.batch_size,
                    'lookback': LOOKBACK,
                    'horizon': HORIZON,
                    'n_windows': len(dataset),
                })

            n_train = int(0.8 * len(dataset))
            train_set, val_set = random_split(dataset, [n_train, len(dataset) - n_train],
                                              generator=torch.Generator().manual_seed(42))
            train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
            val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)

            model = AqiLSTM().to(DEVICE)
            best_mae = train_model(model, train_loader, val_loader, epochs=args.epochs)

            model_path = models_dir / f'lstm_aqi_{region or "global"}_{args.version}.pt'
            torch.save(model.state_dict(), str(model_path))
            log.info(f'Saved {model_path}, best val_mae(norm)={best_mae:.4f}')
            if HAS_MLFLOW:
                mlflow.log_metric('best_val_mae', best_mae)

            register_model(conn, region, args.version, str(model_path), best_mae)

    conn.close()
    log.info('Done.')


class _noop_cm:
    def __enter__(self): return self
    def __exit__(self, *a): return False


if __name__ == '__main__':
    main()
