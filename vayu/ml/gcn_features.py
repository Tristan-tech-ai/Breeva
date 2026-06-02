"""
Tier 3 Phase 3.1.1 / Tier 4 Phase 4.1 — Feature schema for GCN node embedding.

Tier 3 base (53 dims):
  - highway one-hot: 16
  - landuse one-hot: 6
  - surface one-hot: 5
  - region one-hot: 10 (jakarta..makassar + denpasar)
  - numeric static: 12 (lanes, width, maxspeed, canyon_ratio, elevation,
                       traffic_base, traffic_cal, ai_pollution, ai_classified,
                       lng_norm, lat_norm, length)
  - temporal: 4 (hour_sin, hour_cos, dow_sin, dow_cos)

Tier 4 Phase 4.1 adds 10 numeric features (53 → 63), gated by USE_TIER4_FEATURES
so we can ablate cleanly. When True, expects columns to be present in the row
(NaN-tolerant via safe_float defaults):
  - tomtom_congestion_factor  (correction_factor from traffic_calibration, road_class x hour x dow)
  - sentinel_no2 / sentinel_co / sentinel_so2  (from aqi_grid_sentinel, nearest cell)
  - forecast_pm25_h0/h1/h3    (from aqi_forecast, nearest cell)
  - feedback_accuracy_ema     (route_feedback aggregated)
  - dist_industrial_m_log     (log1p of road_segments.dist_industrial_m)
  - crowd_speed_dev_pct       (derived from vayu_contributions vs free-flow speed)
"""

from __future__ import annotations
import numpy as np
import pandas as pd

HIGHWAY_CLASSES = [
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
    'residential', 'living_street', 'service', 'pedestrian', 'footway',
]

LANDUSE_CLASSES = ['commercial', 'industrial', 'residential', 'park', 'mixed', 'suburban']
SURFACE_CLASSES = ['asphalt', 'concrete', 'paved', 'unpaved', 'cobblestone']
REGIONS = [
    'jakarta', 'bali', 'bandung', 'surabaya', 'semarang',
    'yogyakarta', 'solo', 'medan', 'palembang', 'makassar',
    # +7 slugs present in road_segments.region as of 2026-05-17 (32% of rows
    # were silently getting all-zero region one-hot before this addition):
    'malang', 'sulsel', 'sulut', 'sulteng', 'sultra', 'sulbar', 'gorontalo',
]

# Toggle Tier 4 feature pack (+10 dims). Off by default — turn on only when the
# corresponding columns are populated in the parquet snapshot.
USE_TIER4_FEATURES = False

TIER4_FEATURE_NAMES = [
    'tomtom_congestion_factor',
    'sentinel_no2', 'sentinel_co', 'sentinel_so2',
    'forecast_pm25_h0', 'forecast_pm25_h1', 'forecast_pm25_h3',
    'feedback_accuracy_ema',
    'dist_industrial_m_log',
    'crowd_speed_dev_pct',
]

_BASE_DIM = (
    len(HIGHWAY_CLASSES)  # 16
    + len(LANDUSE_CLASSES)  # 6
    + len(SURFACE_CLASSES)  # 5
    + len(REGIONS)  # 10
    + 12  # numeric static
    + 4   # temporal
)
FEATURE_DIM = _BASE_DIM + (len(TIER4_FEATURE_NAMES) if USE_TIER4_FEATURES else 0)
# Tier 3 baseline: 53. Tier 4 Phase 4.1: 63.


def one_hot(value: str | None, classes: list[str]) -> np.ndarray:
    arr = np.zeros(len(classes), dtype=np.float32)
    if value in classes:
        arr[classes.index(value)] = 1.0
    return arr


def safe_float(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _tier4_extras(row: pd.Series) -> np.ndarray:
    """Tier 4 Phase 4.1 extras (10 dims). Defaults chosen as neutral values."""
    return np.array([
        safe_float(row.get('tomtom_congestion_factor'), 1.0),         # free-flow
        safe_float(row.get('sentinel_no2'), 2e-5) * 1e5,              # rescale to ~[0,10]
        safe_float(row.get('sentinel_co'), 0.03) * 100,
        safe_float(row.get('sentinel_so2'), 1e-5) * 1e6,
        safe_float(row.get('forecast_pm25_h0'), 30.0),
        safe_float(row.get('forecast_pm25_h1'), 30.0),
        safe_float(row.get('forecast_pm25_h3'), 30.0),
        safe_float(row.get('feedback_accuracy_ema'), 0.5),
        np.log1p(safe_float(row.get('dist_industrial_m'), 5000.0)),
        safe_float(row.get('crowd_speed_dev_pct'), 0.0),
    ], dtype=np.float32)


def encode_node(row: pd.Series, hour: int = 12, dow: int = 1) -> np.ndarray:
    """Encode single node into flat feature vector [FEATURE_DIM]."""
    parts = [
        one_hot(row.get('highway'), HIGHWAY_CLASSES),
        one_hot(row.get('landuse_proxy'), LANDUSE_CLASSES),
        one_hot(row.get('surface'), SURFACE_CLASSES),
        one_hot(row.get('region'), REGIONS),
        np.array([
            np.log1p(safe_float(row.get('lanes'), 1)),
            np.log1p(safe_float(row.get('width'), 6)),
            np.log1p(safe_float(row.get('maxspeed'), 40)),
            safe_float(row.get('canyon_ratio'), 0.3),
            np.log1p(safe_float(row.get('elevation_avg'), 50) + 100) - np.log(100),
            np.log1p(safe_float(row.get('traffic_base_estimate'), 100)),
            safe_float(row.get('traffic_calibration_factor'), 1.0),
            safe_float(row.get('ai_pollution_factor'), 1.0),
            float(bool(row.get('ai_classified', False))),
            (safe_float(row.get('lng'), 110.0) - 110.0) / 30.0,
            (safe_float(row.get('lat'), -3.0) - (-3.0)) / 8.0,
            np.log1p(safe_float(row.get('length_m'), 100)),
            np.sin(2 * np.pi * hour / 24),
            np.cos(2 * np.pi * hour / 24),
            np.sin(2 * np.pi * dow / 7),
            np.cos(2 * np.pi * dow / 7),
        ], dtype=np.float32),
    ]
    if USE_TIER4_FEATURES:
        parts.append(_tier4_extras(row))
    return np.concatenate(parts)
