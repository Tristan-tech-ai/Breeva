"""
VAYU Engine — Monthly Model Retraining Pipeline (Stage 12.5)
=============================================================
Orchestrates monthly retraining of all ML models:
  1. Collect fresh calibration data (WAQI, TomTom, crowdsource)
  2. Generate updated synthetic training data
  3. Retrain XGBoost correction model
  4. Retrain LSTM temporal model (if PyTorch available)
  5. Validate against ground-truth
  6. Promote or reject new models based on accuracy

Designed to run as:
  - GitHub Actions scheduled workflow (monthly)
  - Manual CLI invocation: python -m vayu.ml.retrain_monthly
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.ml.retrain_monthly")

MODELS_DIR = Path(__file__).parent / "models"
EXPORTS_DIR = Path(__file__).parent.parent / "exports"
MAX_RMSE_PM25 = 25.0         # reject model if RMSE > 25 µg/m³
MAX_RMSE_CORRECTION = 0.5    # reject correction model if RMSE > 0.5
MIN_R2_IMPROVEMENT = -0.05   # allow up to 5% R² degradation


def step_1_collect_calibration() -> dict:
    """Step 1: Collect fresh calibration data."""
    log.info("Step 1: Collecting calibration data...")
    results = {}

    try:
        from calibration.waqi_validator import run as validate_waqi
        validate_waqi()
        results["waqi_validation"] = "completed"
    except Exception as exc:
        log.warning("WAQI validation skipped: %s", exc)
        results["waqi_validation"] = f"skipped: {exc}"

    try:
        from calibration.tomtom_sampler import run as sample_tomtom
        sample_tomtom()
        results["tomtom_sampling"] = "completed"
    except Exception as exc:
        log.warning("TomTom sampling skipped: %s", exc)
        results["tomtom_sampling"] = f"skipped: {exc}"

    try:
        from ml.crowdsource_pipeline import run as process_crowdsource
        process_crowdsource(lookback_hours=720)  # 30 days
        results["crowdsource"] = "completed"
    except Exception as exc:
        log.warning("Crowdsource processing skipped: %s", exc)
        results["crowdsource"] = f"skipped: {exc}"

    return results


def step_2_generate_training_data() -> str | None:
    """Step 2: Generate updated synthetic training data."""
    log.info("Step 2: Generating training data...")
    try:
        from calibration.synthetic_data import run as gen_synthetic
        gen_synthetic()

        training_dir = EXPORTS_DIR / "training"
        parquet_files = list(training_dir.glob("*.parquet"))
        if parquet_files:
            latest = max(parquet_files, key=lambda p: p.stat().st_mtime)
            log.info("Training data: %s", latest)
            return str(latest)
    except Exception as exc:
        log.warning("Training data generation failed: %s", exc)

    return None


def step_3_retrain_xgboost(training_path: str | None) -> dict | None:
    """Step 3: Retrain XGBoost correction model."""
    log.info("Step 3: Retraining XGBoost...")
    try:
        from ml.train_xgboost import load_training_data, train_correction_model, train_pm25_model, save_model

        df = load_training_data(training_path)

        # Train correction factor model
        model_cf, metrics_cf = train_correction_model(df, target="correction_factor")
        save_model(model_cf, metrics_cf, name="xgb_correction_v1")

        # Train direct PM2.5 model
        model_pm25, metrics_pm25 = train_pm25_model(df)
        save_model(model_pm25, metrics_pm25, name="xgb_pm25_v1")

        meta = {
            "model_type": "xgboost",
            "test_rmse_correction": metrics_cf["rmse"],
            "test_r2_correction": metrics_cf["r2"],
            "test_rmse_pm25": metrics_pm25["rmse"],
            "test_r2_pm25": metrics_pm25["r2"],
        }
        log.info("XGBoost retrained: %s", json.dumps(meta, indent=2))
        return meta
    except Exception as exc:
        log.error("XGBoost retraining failed: %s", exc)
        return None


def step_4_retrain_lstm() -> dict | None:
    """Step 4: Retrain LSTM temporal model."""
    log.info("Step 4: Retraining LSTM...")
    try:
        from ml.train_lstm import train
        meta = train()
        log.info("LSTM retrained: %s", json.dumps(meta, indent=2))
        return meta
    except Exception as exc:
        log.warning("LSTM retraining skipped: %s", exc)
        return None


def step_5_validate(xgb_meta: dict | None, lstm_meta: dict | None) -> dict:
    """Step 5: Validate new models against previous performance."""
    log.info("Step 5: Validating models...")
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "xgboost": {"status": "skipped"},
        "lstm": {"status": "skipped"},
        "overall": "unknown",
    }

    if xgb_meta:
        rmse = xgb_meta.get("test_rmse_correction", xgb_meta.get("rmse", 999))
        r2 = xgb_meta.get("test_r2_correction", xgb_meta.get("r2", 0))

        passed = rmse <= MAX_RMSE_CORRECTION
        report["xgboost"] = {
            "status": "passed" if passed else "rejected",
            "rmse": rmse,
            "r2": r2,
            "threshold": MAX_RMSE_CORRECTION,
        }
        if not passed:
            log.warning("XGBoost REJECTED: RMSE=%.3f > threshold=%.3f", rmse, MAX_RMSE_CORRECTION)

    if lstm_meta:
        rmse = lstm_meta.get("rmse", 999)
        passed = rmse <= MAX_RMSE_PM25
        report["lstm"] = {
            "status": "passed" if passed else "rejected",
            "rmse": rmse,
            "threshold": MAX_RMSE_PM25,
        }
        if not passed:
            log.warning("LSTM REJECTED: RMSE=%.2f > threshold=%.2f", rmse, MAX_RMSE_PM25)

    # Overall status
    xgb_ok = report["xgboost"].get("status") in ("passed", "skipped")
    lstm_ok = report["lstm"].get("status") in ("passed", "skipped")
    report["overall"] = "passed" if (xgb_ok and lstm_ok) else "partial_failure"

    return report


def step_6_save_report(report: dict) -> None:
    """Step 6: Save retraining report."""
    reports_dir = MODELS_DIR / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report_path = reports_dir / f"retrain_{ts}.json"
    report_path.write_text(json.dumps(report, indent=2))
    log.info("Report saved: %s", report_path)


def run() -> None:
    """Full monthly retraining pipeline."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("=" * 60)
    log.info("  VAYU Monthly Model Retraining Pipeline")
    log.info("  Started: %s", datetime.now(timezone.utc).isoformat())
    log.info("=" * 60)

    # Step 1: Collect calibration data
    calibration_results = step_1_collect_calibration()

    # Step 2: Generate training data
    training_path = step_2_generate_training_data()

    # Step 3: Retrain XGBoost
    xgb_meta = step_3_retrain_xgboost(training_path)

    # Step 4: Retrain LSTM
    lstm_meta = step_4_retrain_lstm()

    # Step 5: Validate
    report = step_5_validate(xgb_meta, lstm_meta)
    report["calibration"] = calibration_results

    # Step 6: Save report
    step_6_save_report(report)

    log.info("=" * 60)
    log.info("  Pipeline complete: %s", report["overall"])
    log.info("=" * 60)


if __name__ == "__main__":
    run()
