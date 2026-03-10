"""
VAYU Engine — TomTom Traffic Sampler (Stage 10.1)
===================================================
Collects real-time traffic flow data from TomTom Traffic API
to calibrate OSM heuristic estimates per road class, hour, and day.

Samples representative road points across 14 regions, stores
correction factors in ``traffic_calibration`` table.

Free tier: 2,500 req/day — we sample ~100 points × 3 times/day = 300 req.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.traffic import TRAFFIC_BASE, compute_calibration_factor, TomTomFlowResult

log = logging.getLogger("vayu.calibration.tomtom")

TOMTOM_FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
REQUEST_TIMEOUT = 10.0


# Representative sample points per region × road class
# Format: (lat, lon, highway_class, region)
SAMPLE_POINTS: list[tuple[float, float, str, str]] = [
    # Bali
    (-8.6725, 115.2126, "primary", "bali"),         # Jl. Teuku Umar, Denpasar
    (-8.6500, 115.2200, "secondary", "bali"),        # Ubung area
    (-8.7900, 115.1750, "trunk", "bali"),            # Jl. Bypass Ngurah Rai
    (-8.6100, 115.0900, "tertiary", "bali"),         # Tabanan
    # Jakarta
    (-6.1750, 106.8270, "motorway", "jakarta"),      # Tol Dalam Kota
    (-6.2000, 106.8500, "primary", "jakarta"),       # Jl. Sudirman
    (-6.2400, 106.8200, "secondary", "jakarta"),     # Kebayoran
    (-6.1600, 106.8800, "tertiary", "jakarta"),      # Kelapa Gading
    # Surabaya
    (-7.2500, 112.7500, "primary", "surabaya"),      # Jl. Basuki Rahmat
    (-7.2800, 112.7400, "secondary", "surabaya"),    # Wonokromo
    (-7.3200, 112.7300, "trunk", "surabaya"),        # Jl. A. Yani
    # Bandung
    (-6.9100, 107.6100, "primary", "bandung"),       # Jl. Asia Afrika
    (-6.9200, 107.6300, "secondary", "bandung"),     # Dago
    # Makassar
    (-5.1400, 119.4200, "primary", "makassar"),      # Jl. Urip Sumoharjo
    (-5.1600, 119.4100, "secondary", "makassar"),    # Panakkukang
    # Medan
    (3.5900, 98.6700, "primary", "medan"),           # Jl. S. Parman (North latitude)
    (3.5800, 98.6900, "secondary", "medan"),         # Simpang Limun (North latitude)
    # Semarang
    (-6.9700, 110.4200, "primary", "semarang"),      # Jl. Pandanaran
    # Yogyakarta
    (-7.7900, 110.3600, "primary", "yogyakarta"),    # Jl. Malioboro
    # Malang
    (-7.9700, 112.6300, "primary", "malang"),        # Jl. Ijen
]


@dataclass
class SampleResult:
    lat: float
    lon: float
    highway: str
    region: str
    free_flow_speed: float
    current_speed: float
    congestion_ratio: float
    correction_factor: float
    hour_of_day: int
    day_of_week: int
    sampled_at: str


def fetch_flow(lat: float, lon: float, api_key: str) -> TomTomFlowResult | None:
    """Fetch traffic flow from TomTom for a single point."""
    try:
        resp = httpx.get(
            TOMTOM_FLOW_URL,
            params={"point": f"{lat},{lon}", "key": api_key},
            timeout=REQUEST_TIMEOUT,
        )
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
        log.warning("TomTom fetch failed for (%.4f, %.4f): %s", lat, lon, exc)
        return None


def sample_all(api_key: str | None = None) -> list[SampleResult]:
    """
    Sample all representative points from TomTom.
    Returns list of SampleResult with correction factors.
    """
    key = api_key or os.environ.get("TOMTOM_API_KEY", "")
    if not key:
        log.error("TOMTOM_API_KEY not set — cannot sample")
        return []

    now = datetime.now(timezone.utc)
    results: list[SampleResult] = []

    for lat, lon, highway, region in SAMPLE_POINTS:
        flow = fetch_flow(lat, lon, key)
        if flow is None:
            continue

        osm_base = TRAFFIC_BASE.get(highway, 100)
        factor = compute_calibration_factor(osm_base, flow)

        results.append(SampleResult(
            lat=lat, lon=lon,
            highway=highway, region=region,
            free_flow_speed=flow.free_flow_speed,
            current_speed=flow.current_speed,
            congestion_ratio=flow.congestion_ratio,
            correction_factor=factor,
            hour_of_day=now.hour,
            day_of_week=now.weekday(),  # 0=Monday in Python
            sampled_at=now.isoformat(),
        ))

    log.info("Sampled %d/%d points from TomTom", len(results), len(SAMPLE_POINTS))
    return results


def upsert_calibration(results: list[SampleResult]) -> int:
    """
    UPSERT sample results into traffic_calibration table.
    Aggregates by (road_class, hour_of_day, day_of_week).
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing Supabase credentials")
        return 0

    api_base = f"{url}/rest/v1"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    # Aggregate by (road_class, hour, dow)
    agg: dict[tuple[str, int, int], list[SampleResult]] = {}
    for r in results:
        # Map Python weekday (0=Mon) to SQL day (0=Sun)
        sql_dow = (r.day_of_week + 1) % 7
        k = (r.highway, r.hour_of_day, sql_dow)
        agg.setdefault(k, []).append(r)

    rows = []
    for (road_class, hour, dow), samples in agg.items():
        avg_speed = sum(s.current_speed for s in samples) / len(samples)
        avg_ffs = sum(s.free_flow_speed for s in samples) / len(samples)
        avg_congestion = sum(s.congestion_ratio for s in samples) / len(samples)
        avg_factor = sum(s.correction_factor for s in samples) / len(samples)

        rows.append({
            "road_class": road_class,
            "hour_of_day": hour,
            "day_of_week": dow,
            "tomtom_avg_speed": round(avg_speed, 1),
            "tomtom_free_flow_speed": round(avg_ffs, 1),
            "congestion_level": round(avg_congestion, 2),
            "correction_factor": round(avg_factor, 2),
            "sample_count": len(samples),
            "calibrated_at": samples[0].sampled_at,
        })

    if not rows:
        return 0

    resp = requests.post(
        f"{api_base}/traffic_calibration?on_conflict=road_class,hour_of_day,day_of_week",
        headers=headers,
        json=rows,
        timeout=15,
    )
    if resp.status_code in (200, 201):
        log.info("Upserted %d calibration rows", len(rows))
        return len(rows)
    else:
        log.error("Calibration UPSERT failed: %s %s", resp.status_code, resp.text[:200])
        return 0


def run() -> None:
    """Main entry point for GitHub Actions / CLI."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    results = sample_all()
    if results:
        count = upsert_calibration(results)
        log.info("TomTom sampling complete: %d results, %d rows upserted", len(results), count)
    else:
        log.warning("No TomTom results — check API key and connectivity")


if __name__ == "__main__":
    run()
