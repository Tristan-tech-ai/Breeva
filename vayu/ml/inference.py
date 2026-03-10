"""
VAYU Engine — ML Inference Layer (Stage 11.2)
===============================================
Loads trained XGBoost model and applies corrections to CALINE3 predictions.
Used by refresh_hotspots.py (Mode B) to produce layer_source=3 tiles.

The inference layer sits between CALINE3 raw output and the final tile UPSERT,
applying learned correction factors from the XGBoost model.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.ml.inference")

MODEL_DIR = Path(__file__).parent / "models"

# Singleton model cache
_model_cache: dict[str, object] = {}
_feature_cache: dict[str, list[str]] = {}


@dataclass
class InferenceInput:
    """Input features for ML correction."""
    hour: int
    day_of_week: int
    month: int
    wind_speed: float
    wind_direction: float
    temperature: float
    humidity: float
    highway_class_encoded: int
    lanes: int
    road_width: float
    traffic_volume_osm: float
    diurnal_multiplier: float
    canyon_ratio: float
    landuse_encoded: int
    distance_to_road_m: float
    stability_class_encoded: int
    baseline_pm25: float
    baseline_no2: float
    caline3_pm25: float
    caline3_no2: float


@dataclass
class CorrectedPrediction:
    """ML-corrected AQI prediction."""
    pm25_corrected: float
    no2_corrected: float
    aqi_corrected: int
    correction_factor: float
    confidence: float  # ML model confidence (higher = more training data coverage)
    model_version: str


# Highway → encoded int (must match training)
HIGHWAY_ENCODING: dict[str, int] = {
    "motorway": 9, "trunk": 8, "primary": 7, "secondary": 6,
    "tertiary": 5, "unclassified": 4, "residential": 3,
    "living_street": 2, "service": 1, "pedestrian": 0,
    "motorway_link": 8, "trunk_link": 7, "primary_link": 6,
    "secondary_link": 5, "tertiary_link": 4,
}

LANDUSE_ENCODING: dict[str, int] = {
    "forest": 0, "wood": 0, "park": 1, "garden": 1,
    "meadow": 2, "grassland": 2, "farmland": 3,
    "residential": 4, "commercial": 5, "retail": 5,
    "industrial": 6,
}

STABILITY_ENCODING = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5}


def load_model(name: str = "xgb_correction_v1") -> bool:
    """
    Load a trained model into cache.
    Returns True if model loaded successfully.
    """
    if name in _model_cache:
        return True

    model_path = MODEL_DIR / f"{name}.joblib"
    meta_path = MODEL_DIR / f"{name}_meta.json"

    if not model_path.exists():
        log.warning("Model not found: %s", model_path)
        return False

    try:
        _model_cache[name] = joblib.load(model_path)
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            _feature_cache[name] = meta.get("features", [])
        log.info("Loaded model: %s", name)
        return True
    except Exception as exc:
        log.error("Failed to load model %s: %s", name, exc)
        return False


def predict_correction(
    inp: InferenceInput,
    model_name: str = "xgb_correction_v1",
) -> CorrectedPrediction | None:
    """
    Apply ML correction to CALINE3 prediction.

    Returns CorrectedPrediction or None if model not available
    (falls back to raw CALINE3).
    """
    if not load_model(model_name):
        return None

    model = _model_cache[model_name]

    # Build feature vector (must match training order)
    features = np.array([[
        inp.hour, inp.day_of_week, inp.month,
        inp.wind_speed, inp.wind_direction, inp.temperature, inp.humidity,
        inp.highway_class_encoded, inp.lanes, inp.road_width,
        inp.traffic_volume_osm, inp.diurnal_multiplier,
        inp.canyon_ratio, inp.landuse_encoded,
        inp.distance_to_road_m, inp.stability_class_encoded,
        inp.baseline_pm25, inp.baseline_no2,
        inp.caline3_pm25, inp.caline3_no2,
    ]], dtype=np.float32)

    try:
        correction_factor = float(model.predict(features)[0])
        # Clip to reasonable range
        correction_factor = max(0.2, min(correction_factor, 5.0))

        # Apply correction to CALINE3 road contribution
        pm25_road_corrected = inp.caline3_pm25 * correction_factor
        no2_road_corrected = inp.caline3_no2 * correction_factor

        # Total = baseline + corrected road component
        pm25_total = inp.baseline_pm25 + pm25_road_corrected
        no2_total = inp.baseline_no2 + no2_road_corrected

        aqi = _pm25_to_aqi(pm25_total)

        # Confidence based on how far correction_factor is from 1.0
        # High correction = lower confidence in raw model
        conf = max(0.4, min(0.85, 1.0 - abs(correction_factor - 1.0) * 0.3))

        return CorrectedPrediction(
            pm25_corrected=round(pm25_total, 2),
            no2_corrected=round(no2_total, 2),
            aqi_corrected=aqi,
            correction_factor=round(correction_factor, 4),
            confidence=round(conf, 3),
            model_version=model_name,
        )
    except Exception as exc:
        log.warning("ML inference failed: %s", exc)
        return None


def batch_predict(
    inputs: list[InferenceInput],
    model_name: str = "xgb_correction_v1",
) -> list[CorrectedPrediction | None]:
    """Batch ML correction for multiple tiles."""
    if not load_model(model_name):
        return [None] * len(inputs)

    model = _model_cache[model_name]

    features = np.array([
        [
            inp.hour, inp.day_of_week, inp.month,
            inp.wind_speed, inp.wind_direction, inp.temperature, inp.humidity,
            inp.highway_class_encoded, inp.lanes, inp.road_width,
            inp.traffic_volume_osm, inp.diurnal_multiplier,
            inp.canyon_ratio, inp.landuse_encoded,
            inp.distance_to_road_m, inp.stability_class_encoded,
            inp.baseline_pm25, inp.baseline_no2,
            inp.caline3_pm25, inp.caline3_no2,
        ]
        for inp in inputs
    ], dtype=np.float32)

    try:
        corrections = model.predict(features)
        results: list[CorrectedPrediction | None] = []

        for i, inp in enumerate(inputs):
            cf = float(np.clip(corrections[i], 0.2, 5.0))
            pm25 = inp.baseline_pm25 + inp.caline3_pm25 * cf
            no2 = inp.baseline_no2 + inp.caline3_no2 * cf
            conf = max(0.4, min(0.85, 1.0 - abs(cf - 1.0) * 0.3))

            results.append(CorrectedPrediction(
                pm25_corrected=round(pm25, 2),
                no2_corrected=round(no2, 2),
                aqi_corrected=_pm25_to_aqi(pm25),
                correction_factor=round(cf, 4),
                confidence=round(conf, 3),
                model_version=model_name,
            ))

        return results
    except Exception as exc:
        log.warning("Batch ML inference failed: %s", exc)
        return [None] * len(inputs)


def _pm25_to_aqi(pm25: float) -> int:
    """US EPA PM2.5 → AQI conversion."""
    breakpoints = [
        (0.0, 12.0, 0, 50),
        (12.1, 35.4, 51, 100),
        (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200),
        (150.5, 250.4, 201, 300),
        (250.5, 500.0, 301, 500),
    ]
    for c_lo, c_hi, aqi_lo, aqi_hi in breakpoints:
        if pm25 <= c_hi:
            return round(aqi_lo + (aqi_hi - aqi_lo) * (pm25 - c_lo) / max(c_hi - c_lo, 0.1))
    return 500


def is_model_available(name: str = "xgb_correction_v1") -> bool:
    """Check if a trained model exists."""
    return (MODEL_DIR / f"{name}.joblib").exists()
