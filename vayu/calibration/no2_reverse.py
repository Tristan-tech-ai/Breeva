"""
VAYU Engine — Reverse NO₂ Calibration via WAQI (Stage 10.2)
==============================================================
Uses ground-truth NO₂ measurements from WAQI (aqicn.org) monitoring
stations to reverse-calibrate CALINE3 traffic volume estimates.

Logic: observed_NO₂ → back-calculate vehicle count → compare to OSM estimate
       → derive correction_factor per road class and region.

WAQI API: https://api.waqi.info — requires WAQI_TOKEN env var.
Free tier: ~1,000 requests/day.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from dataclasses import dataclass

import httpx
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.caline3 import FLEET_AVG
from core.traffic import TRAFFIC_BASE

log = logging.getLogger("vayu.calibration.no2_reverse")

WAQI_API_BASE = "https://api.waqi.info"
REQUEST_TIMEOUT = 15.0

# Indonesian station IDs mapped to nearest road classes
# These are WAQI station identifiers for major Indonesian cities
STATION_CONFIGS: list[dict] = [
    # Bali
    {"station": "@8723", "region": "bali", "highway": "primary",
     "lat": -8.6725, "lon": 115.2126, "name": "Denpasar"},
    # Jakarta
    {"station": "@7907", "region": "jakarta", "highway": "motorway",
     "lat": -6.1750, "lon": 106.8270, "name": "DKI1 Bundaran HI"},
    {"station": "@7908", "region": "jakarta", "highway": "primary",
     "lat": -6.2000, "lon": 106.8500, "name": "DKI2 Kelapa Gading"},
    {"station": "@7909", "region": "jakarta", "highway": "primary",
     "lat": -6.2600, "lon": 106.8200, "name": "DKI3 Jagakarsa"},
    {"station": "@7910", "region": "jakarta", "highway": "secondary",
     "lat": -6.1400, "lon": 106.8100, "name": "DKI4 Lubang Buaya"},
    {"station": "@7911", "region": "jakarta", "highway": "primary",
     "lat": -6.2300, "lon": 106.7500, "name": "DKI5 Kebon Jeruk"},
    # Surabaya
    {"station": "@9594", "region": "surabaya", "highway": "primary",
     "lat": -7.2500, "lon": 112.7500, "name": "Surabaya SUB1"},
    # Bandung
    {"station": "@11579", "region": "bandung", "highway": "primary",
     "lat": -6.9100, "lon": 107.6100, "name": "Bandung"},
    # Semarang
    {"station": "@11582", "region": "semarang", "highway": "primary",
     "lat": -6.9700, "lon": 110.4200, "name": "Semarang"},
    # --- Geo-based discovery (nearest WAQI station to region center) ---
    # Yogyakarta
    {"station": "geo:-7.78;110.38", "region": "yogyakarta", "highway": "primary",
     "lat": -7.78, "lon": 110.38, "name": "Yogyakarta"},
    # Solo
    {"station": "geo:-7.57;110.82", "region": "solo", "highway": "primary",
     "lat": -7.57, "lon": 110.82, "name": "Solo"},
    # Malang
    {"station": "geo:-7.98;112.63", "region": "malang", "highway": "primary",
     "lat": -7.98, "lon": 112.63, "name": "Malang"},
    # Sulawesi Selatan (Makassar)
    {"station": "geo:-5.14;119.42", "region": "sulsel", "highway": "primary",
     "lat": -5.14, "lon": 119.42, "name": "Makassar"},
    # Sulawesi Barat (Mamuju)
    {"station": "geo:-2.68;118.89", "region": "sulbar", "highway": "primary",
     "lat": -2.68, "lon": 118.89, "name": "Mamuju"},
    # Sulawesi Tengah (Palu)
    {"station": "geo:-0.90;119.87", "region": "sulteng", "highway": "primary",
     "lat": -0.90, "lon": 119.87, "name": "Palu"},
    # Gorontalo
    {"station": "geo:0.54;123.06", "region": "gorontalo", "highway": "primary",
     "lat": 0.54, "lon": 123.06, "name": "Gorontalo"},
    # Sulawesi Utara (Manado)
    {"station": "geo:1.47;124.84", "region": "sulut", "highway": "primary",
     "lat": 1.47, "lon": 124.84, "name": "Manado"},
    # Sulawesi Tenggara (Kendari)
    {"station": "geo:-3.97;122.51", "region": "sultra", "highway": "primary",
     "lat": -3.97, "lon": 122.51, "name": "Kendari"},
]


@dataclass
class StationReading:
    station_id: str
    station_name: str
    region: str
    highway: str
    lat: float
    lon: float
    no2_ug_m3: float  # μg/m³
    pm25_ug_m3: float
    timestamp: str


@dataclass
class ReverseCalibrationResult:
    station_name: str
    region: str
    highway: str
    observed_no2: float         # μg/m³ from WAQI
    estimated_no2_osm: float    # μg/m³ predicted from OSM traffic
    ratio: float                # observed / estimated → correction factor
    implied_vehicles_hr: int    # back-calculated from observed NO₂


def fetch_station_data(station_id: str, token: str) -> dict | None:
    """Fetch latest reading from a WAQI station."""
    try:
        resp = httpx.get(
            f"{WAQI_API_BASE}/feed/{station_id}/",
            params={"token": token},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "ok":
            log.warning("WAQI station %s not ok: %s", station_id, data.get("status"))
            return None
        return data.get("data", {})
    except Exception as exc:
        log.warning("WAQI fetch failed for %s: %s", station_id, exc)
        return None


def extract_pollutants(data: dict) -> tuple[float, float] | None:
    """Extract NO₂ and PM2.5 from WAQI response. Returns (no2_ug, pm25_ug) or None."""
    iaqi = data.get("iaqi", {})

    # WAQI returns AQI sub-indices; convert NO₂ AQI → μg/m³
    no2_aqi = iaqi.get("no2", {}).get("v")
    pm25_aqi = iaqi.get("pm25", {}).get("v")

    if no2_aqi is None:
        return None

    # NO₂ AQI → μg/m³ (US EPA breakpoints, 1-hour)
    no2_ug = _no2_aqi_to_ug(no2_aqi)
    pm25_ug = _pm25_aqi_to_ug(pm25_aqi) if pm25_aqi is not None else 20.0

    return (no2_ug, pm25_ug)


def _no2_aqi_to_ug(aqi: float) -> float:
    """Convert NO₂ AQI value to μg/m³ using US EPA breakpoints."""
    breakpoints = [
        (0, 50, 0, 53),
        (51, 100, 54, 100),
        (101, 150, 101, 360),
        (151, 200, 361, 649),
        (201, 300, 650, 1249),
    ]
    for aqi_lo, aqi_hi, conc_lo, conc_hi in breakpoints:
        if aqi <= aqi_hi:
            return conc_lo + (conc_hi - conc_lo) * (aqi - aqi_lo) / max(aqi_hi - aqi_lo, 1)
    return 1250.0  # cap


def _pm25_aqi_to_ug(aqi: float) -> float:
    """Convert PM2.5 AQI value to μg/m³."""
    breakpoints = [
        (0, 50, 0.0, 12.0),
        (51, 100, 12.1, 35.4),
        (101, 150, 35.5, 55.4),
        (151, 200, 55.5, 150.4),
        (201, 300, 150.5, 250.4),
    ]
    for aqi_lo, aqi_hi, conc_lo, conc_hi in breakpoints:
        if aqi <= aqi_hi:
            return conc_lo + (conc_hi - conc_lo) * (aqi - aqi_lo) / max(aqi_hi - aqi_lo, 1)
    return 250.0


def reverse_no2_to_vehicles(
    observed_no2_ug: float,
    wind_speed: float = 2.0,
    distance_m: float = 50.0,
) -> int:
    """
    Back-calculate implied vehicle count from observed NO₂ concentration.

    Uses simplified Gaussian: C = Q / (π · σy · σz · u)
    Where Q = vehicles/hr × emission_factor(NOx) × segment_length / 3600
    """
    # Typical σy ~10m, σz ~5m at 50m distance, stability D
    sigma_y = 0.08 * max(distance_m, 1) ** 0.894
    sigma_z = 0.06 * max(distance_m, 1) ** 0.894

    # C = Q_line / (π · σy · σz · u), solve for Q_line
    u = max(wind_speed, 0.5)
    c_ug = max(observed_no2_ug, 0.1)

    q_line = c_ug * math.pi * sigma_y * sigma_z * u  # g/m/s
    q_line_g_per_m_s = q_line * 1e-6  # μg → g

    # Q_line = vehicles_per_hour × EF_nox_g_per_km × (1km / 1000m) / 3600
    ef_nox = FLEET_AVG.nox  # g/km
    if ef_nox <= 0:
        return 0

    vehicles_hr = (q_line_g_per_m_s * 3600) / (ef_nox / 1000)
    return max(0, round(vehicles_hr))


def calibrate_stations(token: str | None = None) -> list[ReverseCalibrationResult]:
    """
    Run reverse NO₂ calibration for all configured stations.
    Compares observed NO₂ with predicted NO₂ from OSM traffic estimates.
    """
    api_token = token or os.environ.get("WAQI_TOKEN", "")
    if not api_token:
        log.error("WAQI_TOKEN not set — cannot calibrate")
        return []

    results: list[ReverseCalibrationResult] = []

    for cfg in STATION_CONFIGS:
        data = fetch_station_data(cfg["station"], api_token)
        if data is None:
            continue

        pollutants = extract_pollutants(data)
        if pollutants is None:
            log.info("Station %s: no NO₂ data available", cfg["name"])
            continue

        no2_ug, pm25_ug = pollutants

        # What OSM heuristic would predict
        osm_base = TRAFFIC_BASE.get(cfg["highway"], 100)
        # Simplified: predicted_no2 from OSM base traffic using same dispersion
        predicted_no2 = _estimate_no2_from_traffic(osm_base)

        # Correction ratio
        ratio = no2_ug / max(predicted_no2, 0.1)

        # Back-calculated vehicles
        implied = reverse_no2_to_vehicles(no2_ug)

        results.append(ReverseCalibrationResult(
            station_name=cfg["name"],
            region=cfg["region"],
            highway=cfg["highway"],
            observed_no2=round(no2_ug, 1),
            estimated_no2_osm=round(predicted_no2, 1),
            ratio=round(ratio, 3),
            implied_vehicles_hr=implied,
        ))
        log.info(
            "%s: observed=%.1f μg/m³, predicted=%.1f μg/m³, ratio=%.3f, implied=%d veh/hr",
            cfg["name"], no2_ug, predicted_no2, ratio, implied,
        )

    return results


def _estimate_no2_from_traffic(
    vehicles_per_hour: int,
    wind_speed: float = 2.0,
    distance_m: float = 50.0,
) -> float:
    """
    Predict NO₂ concentration from traffic volume using simplified CALINE3.
    Returns μg/m³.
    """
    ef_nox = FLEET_AVG.nox  # g/km
    q_line = vehicles_per_hour * (ef_nox / 1000) / 3600  # g/m/s

    sigma_y = 0.08 * max(distance_m, 1) ** 0.894
    sigma_z = 0.06 * max(distance_m, 1) ** 0.894
    u = max(wind_speed, 0.5)

    c_g_m3 = q_line / (math.pi * sigma_y * sigma_z * u)
    return c_g_m3 * 1e6  # g → μg


def upsert_results(results: list[ReverseCalibrationResult]) -> int:
    """Store calibration results in Supabase for traffic.py to use."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing Supabase credentials")
        return 0

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    rows = []
    for r in results:
        rows.append({
            "road_class": r.highway,
            "hour_of_day": now.hour,
            "day_of_week": (now.weekday() + 1) % 7,  # Python Mon=0 → SQL Sun=0
            "tomtom_avg_speed": None,
            "tomtom_free_flow_speed": None,
            "congestion_level": None,
            "correction_factor": round(min(r.ratio, 5.0), 2),  # cap at 5x
            "sample_count": 1,
            "calibrated_at": now.isoformat(),
        })

    if not rows:
        return 0

    resp = requests.post(
        f"{url}/rest/v1/traffic_calibration",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        json=rows,
        timeout=15,
    )
    if resp.status_code in (200, 201):
        log.info("Upserted %d NO₂ calibration rows", len(rows))
        return len(rows)
    else:
        log.error("NO₂ calibration UPSERT failed: %s", resp.status_code)
        return 0


def run() -> None:
    """Main entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    results = calibrate_stations()
    if results:
        count = upsert_results(results)
        log.info("NO₂ reverse calibration complete: %d stations, %d rows", len(results), count)
    else:
        log.warning("No calibration results — check WAQI_TOKEN and station availability")


if __name__ == "__main__":
    run()
