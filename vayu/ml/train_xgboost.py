"""
VAYU Engine — XGBoost ML Correction Model (Stage 11.1)
=======================================================
Trains an XGBoost model to correct CALINE3 dispersion predictions
by learning the residual pattern between predicted and observed values.

Input features: weather, traffic, road class, landuse, time, baseline AQ
Target: correction_factor (observed / predicted)

The trained model is saved to vayu/ml/models/ for inference.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.ml.train_xgboost")

MODEL_DIR = Path(__file__).parent / "models"
TRAINING_DIR = Path(__file__).parent.parent / "exports" / "training"

FEATURE_COLUMNS = [
    "hour", "day_of_week", "month",
    "wind_speed", "wind_direction", "temperature", "humidity",
    "highway_class_encoded", "lanes", "road_width",
    "traffic_volume_osm", "diurnal_multiplier",
    "canyon_ratio", "landuse_encoded",
    "distance_to_road_m", "stability_class_encoded",
    "baseline_pm25", "baseline_no2",
    "caline3_pm25", "caline3_no2",
]


def load_training_data(path: str | Path | None = None) -> pd.DataFrame:
    """
    Load training data from Parquet.
    Falls back to synthetic data generation if no file exists.
    """
    if path and Path(path).exists():
        df = pd.read_parquet(path)
        log.info("Loaded training data from %s: %d samples", path, len(df))
        return df

    # Try default locations
    for candidate in sorted(TRAINING_DIR.glob("*.parquet"), reverse=True):
        df = pd.read_parquet(candidate)
        log.info("Loaded training data from %s: %d samples", candidate, len(df))
        return df

    # Generate synthetic data on the fly
    log.info("No training data found — generating synthetic dataset...")
    from calibration.synthetic_data import generate_synthetic_dataset
    return generate_synthetic_dataset(n_samples=10_000)


def train_correction_model(
    df: pd.DataFrame,
    target: str = "correction_factor",
    test_size: float = 0.2,
    seed: int = 42,
) -> tuple[XGBRegressor, dict]:
    """
    Train XGBoost correction model.

    Returns: (model, metrics_dict)
    """
    # Validate columns exist
    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")
    if target not in df.columns:
        raise ValueError(f"Target column '{target}' not found in data")

    X = df[FEATURE_COLUMNS].values
    y = df[target].values

    # Clip extreme targets
    y = np.clip(y, 0.1, 5.0)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed,
    )

    log.info("Training set: %d samples, Test set: %d samples", len(X_train), len(X_test))

    # XGBoost hyperparameters optimized for VAYU
    model = XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=seed,
        n_jobs=-1,
        tree_method="hist",
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    y_pred = model.predict(X_test)

    metrics = {
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 4),
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 4),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "target": target,
        "n_features": len(FEATURE_COLUMNS),
    }

    # Feature importance
    importances = dict(zip(FEATURE_COLUMNS, model.feature_importances_))
    top_features = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10]
    metrics["top_features"] = {k: round(float(v), 4) for k, v in top_features}

    log.info("Model metrics: RMSE=%.4f  MAE=%.4f  R²=%.4f", metrics["rmse"], metrics["mae"], metrics["r2"])
    log.info("Top features: %s", ", ".join(f"{k}={v:.3f}" for k, v in top_features[:5]))

    return model, metrics


def train_pm25_model(df: pd.DataFrame) -> tuple[XGBRegressor, dict]:
    """Train a direct PM2.5 prediction model."""
    return train_correction_model(df, target="observed_pm25")


def save_model(
    model: XGBRegressor,
    metrics: dict,
    name: str = "xgb_correction_v1",
) -> Path:
    """Save trained model and metadata."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    model_path = MODEL_DIR / f"{name}.joblib"
    meta_path = MODEL_DIR / f"{name}_meta.json"

    joblib.dump(model, model_path)

    import json
    meta = {
        "name": name,
        "features": FEATURE_COLUMNS,
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "xgboost_params": model.get_params(),
    }
    # Convert numpy types for JSON serialization
    meta_path.write_text(json.dumps(meta, indent=2, default=str))

    log.info("Model saved to %s (%.1f KB)", model_path, model_path.stat().st_size / 1024)
    return model_path


def run() -> None:
    """Main training pipeline."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("=== VAYU XGBoost Training Pipeline ===")

    # Load data
    df = load_training_data()

    # Train correction factor model
    log.info("\n--- Training Correction Factor Model ---")
    model_cf, metrics_cf = train_correction_model(df, target="correction_factor")
    save_model(model_cf, metrics_cf, name="xgb_correction_v1")

    # Train direct PM2.5 model
    log.info("\n--- Training Direct PM2.5 Model ---")
    model_pm25, metrics_pm25 = train_pm25_model(df)
    save_model(model_pm25, metrics_pm25, name="xgb_pm25_v1")

    log.info("\n=== Training Complete ===")
    log.info("Correction model: R²=%.4f, RMSE=%.4f", metrics_cf["r2"], metrics_cf["rmse"])
    log.info("PM2.5 model:      R²=%.4f, RMSE=%.4f", metrics_pm25["r2"], metrics_pm25["rmse"])


if __name__ == "__main__":
    run()
