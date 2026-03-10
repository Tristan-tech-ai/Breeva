"""
VAYU Engine — Synthetic ML Training Data Generator (Stage 10.3)
================================================================
Generates training data for XGBoost/LSTM models by:
  1. Loading historical aqi_grid snapshots (from Parquet exports)
  2. Running CALINE3 predictions for the same tiles
  3. Pairing with WAQI ground-truth where available
  4. Computing residuals (observed - predicted) as training targets

Output: Parquet + CSV files in vayu/exports/training/
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.caline3 import (
    FLEET_AVG, classify_stability, sigma_y as calc_sigma_y,
    sigma_z as calc_sigma_z,
)
from core.traffic import HOURLY_MULTIPLIER, TRAFFIC_BASE

log = logging.getLogger("vayu.calibration.synthetic_data")

EXPORT_DIR = Path(__file__).parent.parent / "exports" / "training"

# Feature columns for ML model
FEATURE_COLUMNS = [
    "lat", "lon", "hour", "day_of_week", "month",
    "wind_speed", "wind_direction", "temperature", "humidity",
    "highway_class_encoded", "lanes", "road_width",
    "traffic_volume_osm", "diurnal_multiplier",
    "canyon_ratio", "landuse_encoded",
    "distance_to_road_m", "stability_class_encoded",
    "baseline_pm25", "baseline_no2",
    "caline3_pm25", "caline3_no2",
]

TARGET_COLUMNS = [
    "observed_aqi", "observed_pm25", "observed_no2",
    "residual_pm25", "residual_no2", "correction_factor",
]

# Highway class encoding
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

# Region bounding boxes for representative sampling (must cover all 14 VAYU regions)
# Format: (south_lat, west_lon, north_lat, east_lon)
# Equal weight — VAYU must predict accurately in ALL regions
REGION_BOXES: list[tuple[float, float, float, float]] = [
    # Bali
    (-8.85, 114.43, -8.06, 115.72),
    # Jawa
    (-6.30, 106.75, -6.10, 106.95),   # Jakarta
    (-6.95, 107.57, -6.87, 107.67),   # Bandung
    (-7.33, 112.70, -7.23, 112.80),   # Surabaya
    (-7.02, 110.37, -6.94, 110.47),   # Semarang
    (-7.82, 110.34, -7.74, 110.42),   # Yogyakarta
    (-7.60, 110.79, -7.53, 110.86),   # Solo
    (-8.00, 112.60, -7.94, 112.66),   # Malang
    # Sulawesi
    (-5.60, 119.25, -2.80, 120.65),   # Sulsel (Makassar)
    (-3.60, 118.70, -1.40, 119.45),   # Sulbar
    (-2.10, 119.60,  0.90, 123.40),   # Sulteng (Palu)
    ( 0.20, 121.80,  0.95, 123.15),   # Gorontalo
    ( 0.30, 123.20,  1.65, 125.30),   # Sulut (Manado)
    (-5.55, 121.30, -3.00, 124.10),   # Sultra (Kendari)
]


def _simplified_caline3_pm25(
    traffic_vph: float,
    distance_m: float,
    wind_speed: float,
    stability: str,
) -> float:
    """Simplified CALINE3 PM2.5 prediction for a receptor at distance_m from road."""
    ef_pm25 = FLEET_AVG.pm25  # g/km
    q_line = traffic_vph * (ef_pm25 / 1000) / 3600  # g/m/s

    sy = calc_sigma_y(max(distance_m, 1), stability)
    sz = calc_sigma_z(max(distance_m, 1), stability)
    u = max(wind_speed, 0.5)

    c = q_line / (3.14159 * sy * sz * u)
    return c * 1e6  # g/m³ → μg/m³


def _simplified_caline3_no2(
    traffic_vph: float,
    distance_m: float,
    wind_speed: float,
    stability: str,
) -> float:
    """Simplified CALINE3 NO₂ prediction."""
    ef_nox = FLEET_AVG.nox
    q_line = traffic_vph * (ef_nox / 1000) / 3600

    sy = calc_sigma_y(max(distance_m, 1), stability)
    sz = calc_sigma_z(max(distance_m, 1), stability)
    u = max(wind_speed, 0.5)

    c = q_line / (3.14159 * sy * sz * u)
    return c * 1e6


def generate_synthetic_dataset(
    n_samples: int = 10_000,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Generate synthetic training samples by varying:
    - Road class, traffic volume, distance, weather, time
    - Adding noise to simulate real-world variability

    The 'observed' values are CALINE3 predictions + calibrated noise
    representing what WAQI stations or MAP would measure.
    """
    rng = np.random.default_rng(seed)

    records = []
    highway_classes = list(TRAFFIC_BASE.keys())

    # Pre-compute region sampling (equal probability)
    n_regions = len(REGION_BOXES)

    for _ in range(n_samples):
        # Random conditions
        hour = rng.integers(0, 24)
        dow = rng.integers(0, 7)
        month = rng.integers(1, 13)

        # Weather (Indonesian tropical range)
        wind_speed = rng.uniform(0.5, 8.0)
        wind_dir = rng.uniform(0, 360)
        temp = rng.uniform(22, 38)
        humidity = rng.uniform(50, 95)

        # Location — sample from actual region bounding boxes (equal weight)
        region_idx = rng.integers(0, n_regions)
        s_lat, w_lon, n_lat, e_lon = REGION_BOXES[region_idx]
        lat = rng.uniform(s_lat, n_lat)
        lon = rng.uniform(w_lon, e_lon)

        # Road
        highway = rng.choice(highway_classes)
        lanes = rng.choice([1, 2, 3, 4, 6]) if highway not in ("path", "footway", "cycleway") else 0
        road_width = lanes * 3.5 if lanes > 0 else 1.5
        distance_m = rng.uniform(5, 200)
        canyon_ratio = rng.uniform(0, 2.5)
        landuse = rng.choice(list(LANDUSE_ENCODING.keys()))

        # Traffic
        base_traffic = TRAFFIC_BASE.get(highway, 50)
        diurnal = HOURLY_MULTIPLIER.get(hour, 1.0)
        traffic_vph = base_traffic * diurnal * rng.uniform(0.7, 1.3)

        # Stability class
        stability = classify_stability(wind_speed, hour)

        # Baseline (background) AQ — simulating Open-Meteo
        baseline_pm25 = rng.uniform(5, 60)
        baseline_no2 = rng.uniform(2, 80)

        # CALINE3 predictions (road contribution only)
        caline3_pm25 = _simplified_caline3_pm25(traffic_vph, distance_m, wind_speed, stability)
        caline3_no2 = _simplified_caline3_no2(traffic_vph, distance_m, wind_speed, stability)

        # "Observed" = baseline + road contribution + noise
        # Noise represents model error, meteorological variability, etc.
        noise_factor = rng.normal(1.0, 0.2)  # 20% noise
        observed_pm25 = (baseline_pm25 + caline3_pm25) * max(noise_factor, 0.3)
        observed_no2 = (baseline_no2 + caline3_no2) * max(rng.normal(1.0, 0.25), 0.3)

        # Canyon effect (narrow streets trap pollutants)
        if canyon_ratio > 1.0:
            canyon_boost = 1.0 + (canyon_ratio - 1.0) * 0.3
            observed_pm25 *= canyon_boost
            observed_no2 *= canyon_boost

        # Vegetation damping
        landuse_damping = {0: 0.7, 1: 0.8, 2: 0.85, 3: 0.9, 4: 1.0, 5: 1.1, 6: 1.2}
        observed_pm25 *= landuse_damping.get(LANDUSE_ENCODING.get(landuse, 4), 1.0)
        observed_no2 *= landuse_damping.get(LANDUSE_ENCODING.get(landuse, 4), 1.0)

        # AQI from PM2.5 (simplified US EPA)
        observed_aqi = _pm25_to_aqi(observed_pm25)

        # Residuals = what model needs to learn to correct
        predicted_pm25 = baseline_pm25 + caline3_pm25
        predicted_no2 = baseline_no2 + caline3_no2
        residual_pm25 = observed_pm25 - predicted_pm25
        residual_no2 = observed_no2 - predicted_no2
        correction_factor = observed_pm25 / max(predicted_pm25, 0.1)

        records.append({
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "hour": hour,
            "day_of_week": dow,
            "month": month,
            "wind_speed": round(wind_speed, 1),
            "wind_direction": round(wind_dir, 0),
            "temperature": round(temp, 1),
            "humidity": round(humidity, 1),
            "highway_class_encoded": HIGHWAY_ENCODING.get(highway, 3),
            "lanes": lanes,
            "road_width": round(road_width, 1),
            "traffic_volume_osm": round(traffic_vph),
            "diurnal_multiplier": round(diurnal, 2),
            "canyon_ratio": round(canyon_ratio, 1),
            "landuse_encoded": LANDUSE_ENCODING.get(landuse, 4),
            "distance_to_road_m": round(distance_m, 1),
            "stability_class_encoded": STABILITY_ENCODING.get(stability, 3),
            "baseline_pm25": round(baseline_pm25, 1),
            "baseline_no2": round(baseline_no2, 1),
            "caline3_pm25": round(caline3_pm25, 3),
            "caline3_no2": round(caline3_no2, 3),
            "observed_aqi": round(observed_aqi),
            "observed_pm25": round(observed_pm25, 2),
            "observed_no2": round(observed_no2, 2),
            "residual_pm25": round(residual_pm25, 3),
            "residual_no2": round(residual_no2, 3),
            "correction_factor": round(correction_factor, 4),
        })

    return pd.DataFrame(records)


def _pm25_to_aqi(pm25: float) -> int:
    """Simplified US EPA PM2.5 → AQI conversion."""
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


def save_dataset(df: pd.DataFrame, name: str = "synthetic_v1") -> Path:
    """Save dataset to Parquet and CSV."""
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    parquet_path = EXPORT_DIR / f"{name}.parquet"
    csv_path = EXPORT_DIR / f"{name}.csv"

    df.to_parquet(parquet_path, index=False)
    df.to_csv(csv_path, index=False)

    log.info("Saved %d samples to %s (.parquet + .csv)", len(df), EXPORT_DIR)
    return parquet_path


def run() -> None:
    """Main entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("Generating 10,000 synthetic training samples...")
    df = generate_synthetic_dataset(n_samples=10_000)

    log.info("Dataset shape: %s", df.shape)
    log.info("Feature stats:\n%s", df[FEATURE_COLUMNS].describe().round(2))
    log.info("Target stats:\n%s", df[TARGET_COLUMNS].describe().round(2))

    path = save_dataset(df)
    log.info("Training data ready at: %s", path)


if __name__ == "__main__":
    run()
