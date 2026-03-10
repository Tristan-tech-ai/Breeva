"""
VAYU Engine — WAQI Ground-Truth Validator (Stage 10.5)
=======================================================
Compares VAYU Engine AQI predictions against WAQI monitoring station
data to compute accuracy metrics and track model performance over time.

Metrics tracked:
  - RMSE, MAE, R² for PM2.5, NO₂, and AQI
  - Per-region accuracy breakdown
  - Temporal accuracy trends

Results stored in vayu/exports/validation/ and logged to Supabase.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from calibration.no2_reverse import (
    STATION_CONFIGS, _no2_aqi_to_ug, _pm25_aqi_to_ug,
    fetch_station_data,
)

log = logging.getLogger("vayu.calibration.waqi_validator")

VAYU_AQI_URL = "https://breeva.site/api/vayu/aqi"
EXPORT_DIR = Path(__file__).parent.parent / "exports" / "validation"
REQUEST_TIMEOUT = 15.0


@dataclass
class ValidationPair:
    station_name: str
    region: str
    lat: float
    lon: float
    # WAQI observed
    waqi_aqi: int
    waqi_pm25: float
    waqi_no2: float
    # VAYU predicted
    vayu_aqi: int
    vayu_pm25: float
    vayu_no2: float
    vayu_confidence: float
    vayu_layer_source: int
    # Errors
    aqi_error: int
    pm25_error: float
    no2_error: float
    timestamp: str


@dataclass
class ValidationMetrics:
    n_samples: int
    aqi_rmse: float
    aqi_mae: float
    pm25_rmse: float
    pm25_mae: float
    no2_rmse: float
    no2_mae: float
    pm25_r2: float
    no2_r2: float
    per_region: dict[str, dict]
    timestamp: str


def fetch_vayu_prediction(lat: float, lon: float) -> dict | None:
    """Fetch VAYU Engine AQI prediction for a point."""
    try:
        resp = httpx.get(
            VAYU_AQI_URL,
            params={"lat": lat, "lon": lon},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("data", {})
    except Exception as exc:
        log.warning("VAYU fetch failed for (%.4f, %.4f): %s", lat, lon, exc)
        return None


def collect_validation_pairs(waqi_token: str | None = None) -> list[ValidationPair]:
    """
    For each WAQI station, fetch ground-truth AND VAYU prediction,
    then compute errors.
    """
    token = waqi_token or os.environ.get("WAQI_TOKEN", "")
    if not token:
        log.error("WAQI_TOKEN not set")
        return []

    now = datetime.now(timezone.utc)
    pairs: list[ValidationPair] = []

    for cfg in STATION_CONFIGS:
        # Fetch WAQI
        waqi_data = fetch_station_data(cfg["station"], token)
        if waqi_data is None:
            continue

        iaqi = waqi_data.get("iaqi", {})
        waqi_aqi = int(waqi_data.get("aqi", 0))
        pm25_aqi_val = iaqi.get("pm25", {}).get("v")
        no2_aqi_val = iaqi.get("no2", {}).get("v")

        if pm25_aqi_val is None:
            continue

        waqi_pm25 = _pm25_aqi_to_ug(pm25_aqi_val)
        waqi_no2 = _no2_aqi_to_ug(no2_aqi_val) if no2_aqi_val is not None else 0.0

        # Fetch VAYU
        vayu_data = fetch_vayu_prediction(cfg["lat"], cfg["lon"])
        if vayu_data is None:
            continue

        vayu_aqi = vayu_data.get("aqi", 0)
        vayu_pm25 = vayu_data.get("pm25", 0)
        vayu_no2 = vayu_data.get("no2", 0)

        pairs.append(ValidationPair(
            station_name=cfg["name"],
            region=cfg["region"],
            lat=cfg["lat"],
            lon=cfg["lon"],
            waqi_aqi=waqi_aqi,
            waqi_pm25=round(waqi_pm25, 1),
            waqi_no2=round(waqi_no2, 1),
            vayu_aqi=vayu_aqi,
            vayu_pm25=round(vayu_pm25, 1),
            vayu_no2=round(vayu_no2, 1),
            vayu_confidence=vayu_data.get("confidence", 0),
            vayu_layer_source=vayu_data.get("layer_source", 0),
            aqi_error=vayu_aqi - waqi_aqi,
            pm25_error=round(vayu_pm25 - waqi_pm25, 1),
            no2_error=round(vayu_no2 - waqi_no2, 1),
            timestamp=now.isoformat(),
        ))

        log.info(
            "%s: WAQI AQI=%d PM2.5=%.1f | VAYU AQI=%d PM2.5=%.1f | error=%d",
            cfg["name"], waqi_aqi, waqi_pm25, vayu_aqi, vayu_pm25, vayu_aqi - waqi_aqi,
        )

    return pairs


def compute_metrics(pairs: list[ValidationPair]) -> ValidationMetrics | None:
    """Compute aggregate accuracy metrics from validation pairs."""
    if len(pairs) < 2:
        log.warning("Not enough pairs (%d) for metrics", len(pairs))
        return None

    aqi_errors = [p.aqi_error for p in pairs]
    pm25_obs = [p.waqi_pm25 for p in pairs]
    pm25_pred = [p.vayu_pm25 for p in pairs]
    no2_obs = [p.waqi_no2 for p in pairs if p.waqi_no2 > 0]
    no2_pred = [p.vayu_no2 for p in pairs if p.waqi_no2 > 0]

    def rmse(errs: list[float]) -> float:
        return math.sqrt(sum(e ** 2 for e in errs) / len(errs)) if errs else 0

    def mae(errs: list[float]) -> float:
        return sum(abs(e) for e in errs) / len(errs) if errs else 0

    def r_squared(obs: list[float], pred: list[float]) -> float:
        if len(obs) < 2:
            return 0.0
        mean_obs = sum(obs) / len(obs)
        ss_res = sum((o - p) ** 2 for o, p in zip(obs, pred))
        ss_tot = sum((o - mean_obs) ** 2 for o in obs)
        return 1 - ss_res / max(ss_tot, 1e-10)

    pm25_errors = [p - o for o, p in zip(pm25_obs, pm25_pred)]
    no2_errors = [p - o for o, p in zip(no2_obs, no2_pred)] if no2_obs else []

    # Per-region breakdown
    regions: dict[str, list[ValidationPair]] = {}
    for p in pairs:
        regions.setdefault(p.region, []).append(p)

    per_region = {}
    for region, rpairs in regions.items():
        r_aqi_errors = [p.aqi_error for p in rpairs]
        per_region[region] = {
            "n": len(rpairs),
            "aqi_mae": round(mae(r_aqi_errors), 1),
            "aqi_rmse": round(rmse(r_aqi_errors), 1),
        }

    return ValidationMetrics(
        n_samples=len(pairs),
        aqi_rmse=round(rmse(aqi_errors), 1),
        aqi_mae=round(mae(aqi_errors), 1),
        pm25_rmse=round(rmse(pm25_errors), 2),
        pm25_mae=round(mae(pm25_errors), 2),
        no2_rmse=round(rmse(no2_errors), 2) if no2_errors else 0,
        no2_mae=round(mae(no2_errors), 2) if no2_errors else 0,
        pm25_r2=round(r_squared(pm25_obs, pm25_pred), 3),
        no2_r2=round(r_squared(no2_obs, no2_pred), 3) if no2_obs else 0,
        per_region=per_region,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def save_results(
    pairs: list[ValidationPair],
    metrics: ValidationMetrics | None,
) -> Path:
    """Save validation results to Parquet + summary."""
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")

    # Save pairs as Parquet
    df = pd.DataFrame([{
        "station": p.station_name, "region": p.region,
        "waqi_aqi": p.waqi_aqi, "waqi_pm25": p.waqi_pm25, "waqi_no2": p.waqi_no2,
        "vayu_aqi": p.vayu_aqi, "vayu_pm25": p.vayu_pm25, "vayu_no2": p.vayu_no2,
        "aqi_error": p.aqi_error, "pm25_error": p.pm25_error,
        "confidence": p.vayu_confidence, "layer_source": p.vayu_layer_source,
    } for p in pairs])
    parquet_path = EXPORT_DIR / f"validation_{ts}.parquet"
    df.to_parquet(parquet_path, index=False)

    # Save summary
    if metrics:
        summary = (
            f"VAYU Validation Report — {ts}\n"
            f"{'=' * 50}\n\n"
            f"Samples: {metrics.n_samples}\n\n"
            f"AQI:   RMSE={metrics.aqi_rmse}  MAE={metrics.aqi_mae}\n"
            f"PM2.5: RMSE={metrics.pm25_rmse}  MAE={metrics.pm25_mae}  R²={metrics.pm25_r2}\n"
            f"NO₂:   RMSE={metrics.no2_rmse}  MAE={metrics.no2_mae}  R²={metrics.no2_r2}\n\n"
            f"Per Region:\n"
        )
        for region, data in metrics.per_region.items():
            summary += f"  {region}: n={data['n']} AQI_MAE={data['aqi_mae']} RMSE={data['aqi_rmse']}\n"

        summary_path = EXPORT_DIR / f"summary_{ts}.txt"
        summary_path.write_text(summary)
        log.info("Summary:\n%s", summary)

    return parquet_path


def run() -> None:
    """Main entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("Starting WAQI ground-truth validation...")
    pairs = collect_validation_pairs()

    if not pairs:
        log.warning("No validation pairs collected — check WAQI_TOKEN")
        return

    metrics = compute_metrics(pairs)
    path = save_results(pairs, metrics)
    log.info("Validation complete: %d pairs, saved to %s", len(pairs), path)


if __name__ == "__main__":
    run()
