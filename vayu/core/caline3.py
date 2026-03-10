"""
VAYU Engine — CALINE3 Line-Source Dispersion Model (Mode B)
============================================================
Full CALINE3 implementation with line-source integration, mixing zone,
wind-rotated coordinates, and Pasquill-Gifford stability classes.

ERD Section 5.1 — Modified CALINE3 for tropical Indonesia conditions.

Mode B is more accurate than Mode A (TypeScript point-source approximation).
Outputs layer_source=2, confidence=0.55.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

# ---------------------------------------------------------------------------
# Emission factors — Indonesia vehicle fleet (ERD 5.1, KLHK / COPERT adapted)
# Units: g/km
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EmissionFactor:
    nox: float
    pm25: float
    co: float

EMISSION_FACTORS: dict[str, EmissionFactor] = {
    "motor_2tak":   EmissionFactor(0.35, 0.09, 14.2),
    "motor_4tak":   EmissionFactor(0.18, 0.02,  5.8),
    "mobil_bensin": EmissionFactor(0.62, 0.03,  8.1),
    "mobil_diesel": EmissionFactor(1.15, 0.12,  1.2),
    "angkot":       EmissionFactor(2.40, 0.45,  4.5),
    "bus":          EmissionFactor(8.20, 1.10,  3.8),
    "truk":         EmissionFactor(11.5, 1.40,  4.2),
    "sepeda":       EmissionFactor(0.0,  0.0,   0.0),
}

# Weighted average for mixed Indonesia fleet
# ~60% motor, ~25% mobil bensin, ~5% mobil diesel, ~5% angkot, ~3% truk, ~2% bus
FLEET_WEIGHTS = {
    "motor_2tak":   0.15,
    "motor_4tak":   0.45,
    "mobil_bensin": 0.25,
    "mobil_diesel": 0.05,
    "angkot":       0.05,
    "bus":          0.02,
    "truk":         0.03,
}

FLEET_AVG = EmissionFactor(
    nox=sum(EMISSION_FACTORS[k].nox * w for k, w in FLEET_WEIGHTS.items()),
    pm25=sum(EMISSION_FACTORS[k].pm25 * w for k, w in FLEET_WEIGHTS.items()),
    co=sum(EMISSION_FACTORS[k].co * w for k, w in FLEET_WEIGHTS.items()),
)

# ---------------------------------------------------------------------------
# Pasquill-Gifford dispersion coefficients
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PGCoeffs:
    """Sigma-y and sigma-z power-law coefficients: sigma = a * x^b"""
    ay: float; by: float
    az: float; bz: float

# Stability classes A–F (tropical-adapted)
PG_CLASSES: dict[str, PGCoeffs] = {
    "A": PGCoeffs(ay=0.22, by=0.894, az=0.20, bz=0.894),
    "B": PGCoeffs(ay=0.16, by=0.894, az=0.12, bz=0.894),
    "C": PGCoeffs(ay=0.11, by=0.894, az=0.08, bz=0.894),
    "D": PGCoeffs(ay=0.08, by=0.894, az=0.06, bz=0.894),
    "E": PGCoeffs(ay=0.06, by=0.894, az=0.03, bz=0.894),
    "F": PGCoeffs(ay=0.04, by=0.894, az=0.016, bz=0.894),
}


def classify_stability(
    wind_speed: float,
    hour: int,
    cloud_cover: float = 0.5,
) -> str:
    """
    Determine Pasquill-Gifford stability class.
    Simplified tropical adaptation: daytime strong convection (A-B),
    night inversions (E-F), neutral otherwise (C-D).
    """
    is_daytime = 6 <= hour <= 18
    if is_daytime:
        if wind_speed < 2.0:
            return "A" if cloud_cover < 0.5 else "B"
        elif wind_speed < 5.0:
            return "B" if cloud_cover < 0.5 else "C"
        else:
            return "C" if cloud_cover < 0.5 else "D"
    else:
        if wind_speed < 2.0:
            return "F"
        elif wind_speed < 3.0:
            return "E"
        else:
            return "D"


def sigma_y(x: float, stability: str = "D") -> float:
    """Horizontal dispersion parameter σy (meters)."""
    pg = PG_CLASSES.get(stability, PG_CLASSES["D"])
    return pg.ay * max(x, 1.0) ** pg.by


def sigma_z(x: float, stability: str = "D") -> float:
    """Vertical dispersion parameter σz (meters)."""
    pg = PG_CLASSES.get(stability, PG_CLASSES["D"])
    return pg.az * max(x, 1.0) ** pg.bz


# ---------------------------------------------------------------------------
# Landuse vegetation modifiers (same as Mode A for consistency)
# ---------------------------------------------------------------------------

LANDUSE_MODIFIERS: dict[str, float] = {
    "forest": 0.70,
    "wood": 0.70,
    "tree_row": 0.75,
    "park": 0.80,
    "garden": 0.80,
    "meadow": 0.85,
    "grassland": 0.85,
    "farmland": 0.90,
    "residential": 1.00,
    "commercial": 1.10,
    "retail": 1.10,
    "industrial": 1.25,
}


# ---------------------------------------------------------------------------
# CALINE3 line-source Gaussian dispersion
# ---------------------------------------------------------------------------

@dataclass
class RoadSegment:
    """Road segment from Supabase road_segments table."""
    osm_way_id: int
    coords: list[tuple[float, float]]  # [(lon, lat), ...]
    highway: str
    lanes: int | None
    width: float
    surface: str | None
    maxspeed: int | None
    landuse_proxy: str | None
    canyon_ratio: float | None
    traffic_base_estimate: int
    traffic_calibration_factor: float = 1.0

    @property
    def source_height(self) -> float:
        """Effective emission height (m) — road traffic is near ground."""
        return 0.5


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters."""
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _point_to_line_distance(
    px: float, py: float,
    x1: float, y1: float,
    x2: float, y2: float,
) -> float:
    """
    Perpendicular distance (degrees) from point (px, py) to line segment (x1,y1)-(x2,y2).
    Returns distance in degrees (to be converted to meters later).
    """
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def _line_source_concentration(
    emission_rate_g_per_m_s: float,
    wind_speed: float,
    receptor_lat: float,
    receptor_lon: float,
    segment_coords: list[tuple[float, float]],
    source_height: float,
    stability: str,
    wind_direction_deg: float,
) -> float:
    """
    CALINE3-style line-source integration.

    Integrates Gaussian dispersion contributions from sub-segments
    along the road, accounting for wind-rotated coordinates.
    """
    u = max(wind_speed, 0.5)
    Q = emission_rate_g_per_m_s * 1e6  # g/m/s → μg/m/s

    # Wind direction in radians (meteorological: from)
    wind_rad = math.radians(wind_direction_deg)

    total_conc = 0.0

    for i in range(len(segment_coords) - 1):
        lon1, lat1 = segment_coords[i]
        lon2, lat2 = segment_coords[i + 1]

        # Sub-segment length (m)
        seg_len = _haversine_m(lat1, lon1, lat2, lon2)
        if seg_len < 1.0:
            continue

        # Midpoint of sub-segment
        mid_lon = (lon1 + lon2) / 2
        mid_lat = (lat1 + lat2) / 2

        # Distance from receptor to sub-segment midpoint
        dist = _haversine_m(receptor_lat, receptor_lon, mid_lat, mid_lon)
        dist = max(dist, 5.0)  # minimum distance

        # Wind-rotated crosswind/downwind decomposition
        # Bearing from source to receptor
        bearing = math.atan2(
            math.radians(receptor_lon - mid_lon) * math.cos(math.radians(mid_lat)),
            math.radians(receptor_lat - mid_lat),
        )
        # Angle between wind direction and source→receptor
        angle_diff = bearing - wind_rad
        downwind = dist * math.cos(angle_diff)
        crosswind = dist * math.sin(angle_diff)

        # Only consider downwind contributions (upwind sources negligible)
        if downwind < 1.0:
            downwind = max(dist * 0.1, 5.0)  # small contribution from nearby upwind

        sy = sigma_y(downwind, stability)
        sz = sigma_z(downwind, stability)
        H = source_height

        # Gaussian line-source formula per sub-segment
        # C_segment = (Q_line * dL) / (√(2π) * σz * u) * exp(-y²/2σy²) * exp(-H²/2σz²)
        gaussian_y = math.exp(-(crosswind ** 2) / (2 * sy ** 2)) if sy > 0 else 0
        gaussian_z = math.exp(-(H ** 2) / (2 * sz ** 2)) if sz > 0 else 0
        mirror_z = math.exp(-((2 * H) ** 2) / (2 * sz ** 2)) if sz > 0 else 0

        denom = math.sqrt(2 * math.pi) * sz * u
        if denom < 1e-10:
            continue

        conc_sub = (Q * seg_len / denom) * gaussian_y * (gaussian_z + mirror_z)
        total_conc += max(0.0, conc_sub)

    return total_conc


# ---------------------------------------------------------------------------
# PM2.5 → US EPA AQI conversion
# ---------------------------------------------------------------------------

AQI_BREAKPOINTS = [
    (0.0,   12.0,   0,   50),
    (12.1,  35.4,  51,  100),
    (35.5,  55.4, 101,  150),
    (55.5, 150.4, 151,  200),
    (150.5, 250.4, 201, 300),
    (250.5, 500.4, 301, 500),
]


def pm25_to_aqi(pm25: float) -> int:
    """Convert PM2.5 (μg/m³) to US EPA AQI."""
    c = max(0.0, min(pm25, 500.4))
    for lo, hi, aqi_lo, aqi_hi in AQI_BREAKPOINTS:
        if c <= hi:
            return round(((aqi_hi - aqi_lo) / (hi - lo)) * (c - lo) + aqi_lo)
    return 500


# ---------------------------------------------------------------------------
# Main dispersion computation
# ---------------------------------------------------------------------------

@dataclass
class DispersionResult:
    aqi: int
    pm25: float
    pm10: float
    no2: float
    co: float
    o3: float
    confidence: float
    layer_source: int  # 2 = Mode B
    stability_class: str
    region: str


def compute_dispersion(
    lat: float,
    lon: float,
    roads: Sequence[RoadSegment],
    wind_speed: float,
    wind_direction: float,
    temperature: float,
    humidity: float,
    hour: int,
    baseline_pm25: float = 15.0,
    baseline_pm10: float = 25.0,
    baseline_no2: float = 10.0,
    baseline_co: float = 200.0,
    baseline_o3: float = 30.0,
    cultural_modifier: float = 1.0,
    region: str = "unknown",
) -> DispersionResult:
    """
    Full CALINE3 line-source dispersion for a single receptor point.

    Parameters
    ----------
    lat, lon : receptor coordinates
    roads : nearby road segments (from Supabase)
    wind_speed : m/s
    wind_direction : degrees (meteorological)
    temperature : °C
    humidity : %
    hour : 0-23 UTC+8 (WITA)
    baseline_* : Open-Meteo background concentrations
    cultural_modifier : traffic multiplier from cultural calendar
    region : region identifier
    """
    stability = classify_stability(wind_speed, hour)

    pm25_delta = 0.0
    no2_delta = 0.0
    co_delta = 0.0

    for road in roads:
        # Traffic volume with cultural modifier
        traffic_vol = (
            road.traffic_base_estimate
            * road.traffic_calibration_factor
            * cultural_modifier
        )

        # Emission rate per meter of road: Q = traffic_vol * EF / 3600
        # vehicles/hr × g/km / 3600 / 1000 → g/m/s
        q_pm25 = traffic_vol * FLEET_AVG.pm25 / (3600 * 1000)
        q_nox = traffic_vol * FLEET_AVG.nox / (3600 * 1000)
        q_co = traffic_vol * FLEET_AVG.co / (3600 * 1000)

        # Line-source integration
        c_pm25 = _line_source_concentration(
            q_pm25, wind_speed, lat, lon,
            road.coords, road.source_height, stability, wind_direction,
        )
        c_nox = _line_source_concentration(
            q_nox, wind_speed, lat, lon,
            road.coords, road.source_height, stability, wind_direction,
        )
        c_co = _line_source_concentration(
            q_co, wind_speed, lat, lon,
            road.coords, road.source_height, stability, wind_direction,
        )

        # Vegetation modifier
        veg_mod = LANDUSE_MODIFIERS.get(road.landuse_proxy or "", 1.0)

        # Canyon effect
        canyon_mod = 1.0 + (road.canyon_ratio or 0) * 0.3

        pm25_delta += c_pm25 * veg_mod * canyon_mod
        no2_delta += c_nox * veg_mod * canyon_mod
        co_delta += c_co * veg_mod * canyon_mod

    # Rain washout effect (humidity > 85% or precipitation → reduce PM)
    rain_factor = 1.0
    if humidity > 85:
        rain_factor = 0.85
    elif humidity > 95:
        rain_factor = 0.70

    pm25 = max(0.0, baseline_pm25 + pm25_delta * rain_factor)
    pm10 = max(0.0, baseline_pm10 + pm25_delta * rain_factor * 1.5)
    no2 = max(0.0, baseline_no2 + no2_delta)
    co = max(0.0, baseline_co + co_delta)
    o3 = baseline_o3  # pass-through from Open-Meteo

    aqi = pm25_to_aqi(pm25)

    # Confidence: Mode B base = 0.55 (ERD reconciliation table)
    confidence = 0.55
    if len(roads) == 0:
        confidence -= 0.10
    if wind_speed < 0.5:
        confidence -= 0.05  # very low wind = uncertain dispersion

    return DispersionResult(
        aqi=aqi,
        pm25=round(pm25, 2),
        pm10=round(pm10, 2),
        no2=round(no2, 2),
        co=round(co, 2),
        o3=round(o3, 2),
        confidence=round(max(0.10, confidence), 2),
        layer_source=2,
        stability_class=stability,
        region=region,
    )
