"""
VAYU Engine — Traffic Estimation Module
=========================================
Multi-source traffic volume estimation:
  Layer 1: OSM heuristic (highway classification → vehicles/hour)
  Layer 2: TomTom Traffic API calibration (Phase 0.5)
  Layer 3: Reverse NO₂ calibration (Phase 1+)
  Layer 4: Crowdsource GPS speed traces (future)

ERD Section 4 — Traffic Data.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

log = logging.getLogger("vayu.traffic")

# ---------------------------------------------------------------------------
# Layer 1: OSM heuristic — highway class → base vehicles/hour
# Adapted from IVT/COPERT for Indonesian road conditions.
# Same values used in process_osm.py for initial seeding.
# ---------------------------------------------------------------------------

TRAFFIC_BASE: dict[str, int] = {
    "motorway": 2000,
    "motorway_link": 1500,
    "trunk": 1500,
    "trunk_link": 1200,
    "primary": 1000,
    "primary_link": 800,
    "secondary": 600,
    "secondary_link": 500,
    "tertiary": 300,
    "tertiary_link": 250,
    "unclassified": 150,
    "residential": 100,
    "living_street": 50,
    "service": 30,
    "pedestrian": 5,
    "track": 10,
    "path": 0,
    "footway": 0,
    "cycleway": 0,
}


def estimate_base_traffic(highway: str, lanes: int | None = None) -> int:
    """
    Estimate base traffic volume from OSM highway classification.
    Adjusts for lane count (more lanes → more capacity with diminishing returns).
    """
    base = TRAFFIC_BASE.get(highway, 50)
    if lanes is not None and lanes > 2:
        base = int(base * (lanes / 2) * 0.8)
    return base


# ---------------------------------------------------------------------------
# Diurnal pattern — hour → traffic multiplier (matches cultural_calendar.py)
# ---------------------------------------------------------------------------

HOURLY_MULTIPLIER: dict[int, float] = {
    0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
    5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
    10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
    15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
    20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
}


def get_diurnal_multiplier(hour: int) -> float:
    """Return traffic multiplier for a given hour (0-23)."""
    return HOURLY_MULTIPLIER.get(hour % 24, 1.0)


# ---------------------------------------------------------------------------
# Layer 2: TomTom Traffic API calibration (Phase 0.5)
# ---------------------------------------------------------------------------

@dataclass
class TomTomFlowResult:
    free_flow_speed: float   # km/h
    current_speed: float     # km/h
    congestion_ratio: float  # 0-1 (1 = no congestion)


def fetch_tomtom_flow(lat: float, lon: float) -> TomTomFlowResult | None:
    """
    Fetch real-time traffic flow from TomTom Traffic API.
    Requires TOMTOM_API_KEY environment variable.
    Free tier: 2,500 requests/day.
    """
    api_key = os.environ.get("TOMTOM_API_KEY", "")
    if not api_key:
        return None

    url = (
        f"https://api.tomtom.com/traffic/services/4/flowSegmentData"
        f"/absolute/10/json?point={lat},{lon}&key={api_key}"
    )
    try:
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        data = resp.json().get("flowSegmentData", {})
        ffs = data.get("freeFlowSpeed", 50)
        cs = data.get("currentSpeed", 50)
        return TomTomFlowResult(
            free_flow_speed=ffs,
            current_speed=cs,
            congestion_ratio=cs / max(ffs, 1),
        )
    except Exception as exc:
        log.warning("TomTom flow fetch failed: %s", exc)
        return None


def compute_calibration_factor(
    osm_base: int,
    tomtom_flow: TomTomFlowResult | None,
) -> float:
    """
    Compute calibration factor comparing OSM heuristic to TomTom real-time.

    When congestion_ratio < 1 → traffic is heavier than free-flow.
    Lower speed = more vehicles = higher emission per km.
    """
    if tomtom_flow is None:
        return 1.0

    cr = tomtom_flow.congestion_ratio
    # Inverse relationship: slower traffic = higher density
    # But also lower speed = less throughput at extreme congestion
    if cr > 0.8:
        return 1.0  # normal flow
    elif cr > 0.5:
        return 1.0 + (0.8 - cr) * 2.5  # moderate congestion → up to 1.75x
    elif cr > 0.2:
        return 1.75 + (0.5 - cr) * 1.5  # heavy congestion → up to 2.20x
    else:
        return 2.0  # gridlock — fewer vehicles passing but more idling


# ---------------------------------------------------------------------------
# Combined traffic estimation
# ---------------------------------------------------------------------------

def estimate_traffic_volume(
    highway: str,
    lanes: int | None,
    hour: int,
    cultural_modifier: float = 1.0,
    calibration_factor: float = 1.0,
) -> int:
    """
    Full traffic estimation pipeline.

    Returns estimated vehicles/hour at the given time.
    """
    base = estimate_base_traffic(highway, lanes)
    diurnal = get_diurnal_multiplier(hour)
    return round(base * diurnal * cultural_modifier * calibration_factor)
