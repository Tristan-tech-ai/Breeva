"""
VAYU Engine — LSTM Temporal Pattern Model (Stage 12.1)
======================================================
Time-series forecasting for AQI using LSTM (PyTorch).
Predicts next-N-hour AQI from historical hourly sequences.

Architecture:
  Input  → [batch, seq_len=24, features=8]
  LSTM   → 2 layers, hidden=64
  Linear → 1 output (predicted AQI)

Features per timestep:
  0: aqi_value       (normalized 0-1, /500)
  1: hour            (sin-encoded)
  2: hour_cos        (cos-encoded)
  3: day_of_week     (sin-encoded, /7)
  4: wind_speed      (normalized /30)
  5: temperature     (normalized /50)
  6: humidity        (normalized /100)
  7: traffic_factor  (diurnal, already 0-2)
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import cos, pi, sin
from pathlib import Path

import numpy as np

log = logging.getLogger("vayu.ml.train_lstm")

SEQUENCE_LENGTH = 24   # 24 hours lookback
PREDICT_HORIZON = 6    # predict next 6 hours
NUM_FEATURES = 8
HIDDEN_SIZE = 64
NUM_LAYERS = 2
LEARNING_RATE = 1e-3
EPOCHS = 50
BATCH_SIZE = 32
MODELS_DIR = Path(__file__).parent / "models"


@dataclass
class LSTMConfig:
    seq_length: int = SEQUENCE_LENGTH
    predict_horizon: int = PREDICT_HORIZON
    num_features: int = NUM_FEATURES
    hidden_size: int = HIDDEN_SIZE
    num_layers: int = NUM_LAYERS
    learning_rate: float = LEARNING_RATE
    epochs: int = EPOCHS
    batch_size: int = BATCH_SIZE


def encode_hour(hour: int) -> tuple[float, float]:
    """Sin/cos encoding for hour-of-day (cyclical)."""
    rad = 2 * pi * hour / 24
    return sin(rad), cos(rad)


def encode_dow(dow: int) -> float:
    """Simple sin encoding for day-of-week."""
    return sin(2 * pi * dow / 7)


def normalize_features(raw: dict) -> list[float]:
    """
    Normalize a single timestep dict into feature vector.
    Expected keys: aqi, hour, day_of_week, wind_speed, temperature, humidity, traffic_factor
    """
    aqi = min(raw.get("aqi", 50), 500) / 500.0
    hour = raw.get("hour", 12)
    h_sin, h_cos = encode_hour(hour)
    dow = encode_dow(raw.get("day_of_week", 0))
    wind = min(raw.get("wind_speed", 5), 30) / 30.0
    temp = min(max(raw.get("temperature", 28), -10), 50) / 50.0
    hum = min(raw.get("humidity", 70), 100) / 100.0
    traffic = min(raw.get("traffic_factor", 1.0), 2.0)

    return [aqi, h_sin, h_cos, dow, wind, temp, hum, traffic]


def generate_synthetic_sequences(
    n_sequences: int = 2000,
    config: LSTMConfig | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic hourly AQI sequences for training.
    Returns (X, y) where X=[n, seq_len, features], y=[n, horizon].
    """
    cfg = config or LSTMConfig()
    total_len = cfg.seq_length + cfg.predict_horizon

    rng = np.random.default_rng(42)
    X_all = []
    y_all = []

    # Diurnal AQI pattern (Indonesia typical)
    diurnal_base = [
        40, 38, 35, 33, 32, 35, 45, 60, 75, 80, 78, 72,
        68, 65, 62, 65, 72, 85, 90, 82, 70, 58, 50, 45,
    ]

    for _ in range(n_sequences):
        # Random base offset
        base_offset = rng.uniform(-10, 80)
        # Random day type
        start_hour = rng.integers(0, 24)
        start_dow = rng.integers(0, 7)
        # Weather conditions (stable over sequence)
        wind = rng.uniform(1, 15)
        temp = rng.uniform(22, 36)
        hum = rng.uniform(50, 95)

        sequence = []
        for t in range(total_len):
            hour = (start_hour + t) % 24
            dow = (start_dow + (start_hour + t) // 24) % 7

            # Diurnal pattern + offset + noise
            aqi = diurnal_base[hour] + base_offset + rng.normal(0, 8)
            # Weekend slightly lower
            if dow >= 5:
                aqi *= 0.85
            aqi = max(0, min(aqi, 500))

            traffic_factor = [
                0.08, 0.05, 0.05, 0.08, 0.15, 0.40,
                0.80, 1.20, 1.40, 1.20, 1.00, 0.90,
                0.95, 1.00, 1.05, 1.20, 1.40, 1.60,
                1.50, 1.20, 0.80, 0.50, 0.30, 0.15,
            ][hour]

            features = normalize_features({
                "aqi": aqi,
                "hour": hour,
                "day_of_week": dow,
                "wind_speed": wind + rng.normal(0, 1),
                "temperature": temp + rng.normal(0, 0.5),
                "humidity": hum + rng.normal(0, 2),
                "traffic_factor": traffic_factor,
            })
            sequence.append(features)

        # X = first seq_length timesteps, y = AQI of next horizon steps
        X_all.append(sequence[: cfg.seq_length])
        y_all.append([
            sequence[cfg.seq_length + h][0] * 500  # de-normalize AQI
            for h in range(cfg.predict_horizon)
        ])

    return np.array(X_all, dtype=np.float32), np.array(y_all, dtype=np.float32)


def train(config: LSTMConfig | None = None) -> dict:
    """
    Train LSTM model using PyTorch.
    Falls back to a simple persistence baseline if torch unavailable.
    """
    cfg = config or LSTMConfig()

    log.info("Generating %d synthetic sequences (seq=%d, horizon=%d)...", 2000, cfg.seq_length, cfg.predict_horizon)
    X, y = generate_synthetic_sequences(2000, cfg)

    # Split 80/20
    split = int(len(X) * 0.8)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    try:
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset
    except ImportError:
        log.warning("PyTorch not available — saving persistence baseline")
        return _save_baseline_model(X_val, y_val, cfg)

    # Model definition
    class AQI_LSTM(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=cfg.num_features,
                hidden_size=cfg.hidden_size,
                num_layers=cfg.num_layers,
                batch_first=True,
                dropout=0.2 if cfg.num_layers > 1 else 0,
            )
            self.fc = nn.Linear(cfg.hidden_size, cfg.predict_horizon)

        def forward(self, x):
            lstm_out, _ = self.lstm(x)
            return self.fc(lstm_out[:, -1, :])  # last timestep

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = AQI_LSTM().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=cfg.learning_rate)
    criterion = nn.MSELoss()

    train_ds = TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train))
    val_ds = TensorDataset(torch.from_numpy(X_val), torch.from_numpy(y_val))
    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size)

    best_val_loss = float("inf")
    best_state = None

    for epoch in range(cfg.epochs):
        # Train
        model.train()
        train_loss = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * xb.size(0)
        train_loss /= len(train_ds)

        # Validate
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb)
                val_loss += criterion(pred, yb).item() * xb.size(0)
        val_loss /= len(val_ds)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = model.state_dict()

        if (epoch + 1) % 10 == 0:
            log.info("Epoch %d/%d — train_loss=%.2f, val_loss=%.2f", epoch + 1, cfg.epochs, train_loss, val_loss)

    # Save best model
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODELS_DIR / "lstm_aqi_temporal.pt"
    if best_state:
        torch.save(best_state, model_path)

    meta = {
        "model_type": "LSTM",
        "seq_length": cfg.seq_length,
        "predict_horizon": cfg.predict_horizon,
        "num_features": cfg.num_features,
        "hidden_size": cfg.hidden_size,
        "num_layers": cfg.num_layers,
        "best_val_loss": round(best_val_loss, 4),
        "rmse": round(best_val_loss ** 0.5, 2),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "device": str(device),
        "epochs": cfg.epochs,
    }
    meta_path = MODELS_DIR / "lstm_aqi_temporal_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))

    log.info("LSTM saved to %s (val_RMSE=%.2f)", model_path, meta["rmse"])
    return meta


def _save_baseline_model(X_val: np.ndarray, y_val: np.ndarray, cfg: LSTMConfig) -> dict:
    """Persistence baseline: predict last known AQI for all future steps."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Last AQI from each validation sequence (feature index 0, de-normalized)
    preds = X_val[:, -1, 0] * 500  # shape: (n_val,)
    preds_expanded = np.repeat(preds[:, None], cfg.predict_horizon, axis=1)
    mse = float(np.mean((preds_expanded - y_val) ** 2))

    meta = {
        "model_type": "persistence_baseline",
        "seq_length": cfg.seq_length,
        "predict_horizon": cfg.predict_horizon,
        "val_mse": round(mse, 4),
        "rmse": round(mse ** 0.5, 2),
        "note": "PyTorch not available — baseline only. Install torch for LSTM.",
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_path = MODELS_DIR / "lstm_aqi_temporal_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    log.info("Baseline model saved (RMSE=%.2f). Install PyTorch for LSTM training.", meta["rmse"])
    return meta


def predict(sequence: list[dict], config: LSTMConfig | None = None) -> list[float] | None:
    """
    Predict next-N-hour AQI from a 24-hour sequence of observations.
    Returns list of predicted AQI values, or None if model unavailable.
    """
    cfg = config or LSTMConfig()

    try:
        import torch
    except ImportError:
        return _predict_persistence(sequence, cfg)

    model_path = MODELS_DIR / "lstm_aqi_temporal.pt"
    if not model_path.exists():
        return _predict_persistence(sequence, cfg)

    import torch.nn as nn

    class AQI_LSTM(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(
                input_size=cfg.num_features,
                hidden_size=cfg.hidden_size,
                num_layers=cfg.num_layers,
                batch_first=True,
            )
            self.fc = nn.Linear(cfg.hidden_size, cfg.predict_horizon)

        def forward(self, x):
            lstm_out, _ = self.lstm(x)
            return self.fc(lstm_out[:, -1, :])

    device = torch.device("cpu")
    model = AQI_LSTM().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
    model.eval()

    # Normalize input sequence
    features = [normalize_features(obs) for obs in sequence[-cfg.seq_length:]]
    # Pad if shorter than seq_length
    while len(features) < cfg.seq_length:
        features.insert(0, features[0])

    x = torch.tensor([features], dtype=torch.float32).to(device)
    with torch.no_grad():
        predictions = model(x).squeeze(0).cpu().numpy()

    return [max(0, min(float(p), 500)) for p in predictions]


def _predict_persistence(sequence: list[dict], cfg: LSTMConfig) -> list[float]:
    """Fallback: predict last known AQI for all future steps."""
    last_aqi = sequence[-1].get("aqi", 50) if sequence else 50
    return [last_aqi] * cfg.predict_horizon


def run() -> None:
    """CLI entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    log.info("=== LSTM Temporal Pattern Model Training ===")
    meta = train()
    log.info("Training complete: %s", json.dumps(meta, indent=2))


if __name__ == "__main__":
    run()
