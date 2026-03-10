"""
VAYU Engine — Hot-Spot Refresh Job
====================================
Main background cron job that recomputes AQI for the most-requested tiles.
Invoked by GitHub Actions ``vayu-refresh.yml`` (hourly at :15).

Pipeline:
  1. Query hot tiles from ``aqi_grid`` (by hit_count desc)
  2. For each tile: fetch weather, baseline AQ, nearby roads
  3. Run full CALINE3 line-source dispersion (Mode B)
  4. UPSERT results with layer_source=2, confidence=0.55

ERD Section 3.1 Path B, 17.7
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

# Add project root to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.caline3 import RoadSegment, compute_dispersion
from core.cultural_calendar import get_cultural_modifier
from core.grid_manager import AQITile, fetch_hot_tiles, upsert_tiles
from core.osm_processor import detect_region
from core.weather import fetch_air_quality_sync, fetch_weather_sync

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("refresh_hotspots")

VALID_DURATION_MIN = 30  # tile validity window


def _rows_to_road_segments(rows: list[dict]) -> list[RoadSegment]:
    """Convert Supabase road_segments rows to RoadSegment dataclass instances."""
    segments = []
    for r in rows:
        # Parse geometry (GeoJSON LineString) to coord list
        geom = r.get("geom")
        coords: list[tuple[float, float]] = []
        if isinstance(geom, dict):
            coords = [tuple(c) for c in geom.get("coordinates", [])]
        elif isinstance(geom, str):
            import json
            try:
                g = json.loads(geom)
                coords = [tuple(c) for c in g.get("coordinates", [])]
            except (json.JSONDecodeError, TypeError):
                pass

        if len(coords) < 2:
            continue

        segments.append(RoadSegment(
            osm_way_id=r.get("osm_way_id", 0),
            coords=coords,
            highway=r.get("highway", "residential"),
            lanes=r.get("lanes"),
            width=r.get("width", 4.0),
            surface=r.get("surface"),
            maxspeed=r.get("maxspeed"),
            landuse_proxy=r.get("landuse_proxy"),
            canyon_ratio=r.get("canyon_ratio"),
            traffic_base_estimate=r.get("traffic_base_estimate", 100),
            traffic_calibration_factor=r.get("traffic_calibration_factor", 1.0),
        ))
    return segments


def refresh_tile(lat: float, lon: float, tile_id: str, region: str) -> AQITile | None:
    """Refresh a single tile using full CALINE3 Mode B dispersion."""
    now = datetime.now(timezone.utc)

    # Fetch weather + air quality baseline
    weather = fetch_weather_sync(lat, lon)
    baseline = fetch_air_quality_sync(lat, lon)

    # Fetch nearby roads from Supabase
    from core.osm_processor import fetch_nearby_roads
    road_rows = fetch_nearby_roads(lat, lon, radius_m=500, limit=20)
    roads = _rows_to_road_segments(road_rows)

    # Cultural modifier
    # Use WITA (UTC+8) for Indonesian time
    wita_now = now + timedelta(hours=8)
    cultural = get_cultural_modifier(wita_now, region)

    # Run full CALINE3 dispersion
    result = compute_dispersion(
        lat=lat, lon=lon,
        roads=roads,
        wind_speed=weather.wind_speed,
        wind_direction=weather.wind_direction,
        temperature=weather.temperature,
        humidity=weather.humidity,
        hour=wita_now.hour,
        baseline_pm25=baseline.pm25,
        baseline_pm10=baseline.pm10,
        baseline_no2=baseline.no2,
        baseline_co=baseline.co,
        baseline_o3=baseline.o3,
        cultural_modifier=cultural.combined,
        region=region,
    )

    valid_until = (now + timedelta(minutes=VALID_DURATION_MIN)).isoformat()

    return AQITile(
        tile_id=tile_id,
        lat=lat, lon=lon,
        aqi=result.aqi,
        pm25=result.pm25,
        pm10=result.pm10,
        no2=result.no2,
        co=result.co,
        o3=result.o3,
        confidence=result.confidence,
        layer_source=2,  # Mode B
        region=region,
        valid_until=valid_until,
        stability_class=result.stability_class,
    )


def main(max_tiles: int = 500, min_hits: int = 5):
    """Main refresh loop."""
    log.info("🔄 VAYU Hot-Spot Refresh — Mode B (Full CALINE3)")
    log.info("  Max tiles: %d, min hit_count: %d", max_tiles, min_hits)

    # 1. Fetch hot tiles
    hot_tiles = fetch_hot_tiles(min_hit_count=min_hits, limit=max_tiles)
    if not hot_tiles:
        log.info("  No hot tiles found — nothing to refresh.")
        return

    log.info("  Found %d hot tiles to refresh", len(hot_tiles))

    # 2. Process each tile
    refreshed: list[AQITile] = []
    errors = 0

    for i, tile in enumerate(hot_tiles):
        tile_id = tile.get("tile_id", "")
        lat = tile.get("lat", 0)
        lon = tile.get("lon", 0)
        region = tile.get("region", detect_region(lat, lon))

        try:
            result = refresh_tile(lat, lon, tile_id, region)
            if result:
                refreshed.append(result)
        except Exception as exc:
            log.warning("  Failed tile %s: %s", tile_id, exc)
            errors += 1

        # Progress
        if (i + 1) % 50 == 0:
            log.info("  Progress: %d/%d tiles", i + 1, len(hot_tiles))

    # 3. Batch UPSERT
    if refreshed:
        upserted = upsert_tiles(refreshed)
        log.info("✅ Refreshed %d tiles (%d errors, %d UPSERTed)", len(refreshed), errors, upserted)
    else:
        log.info("  No tiles to UPSERT")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="VAYU Hot-Spot Refresh")
    parser.add_argument("--max-tiles", type=int, default=500)
    parser.add_argument("--min-hits", type=int, default=5)
    args = parser.parse_args()
    main(max_tiles=args.max_tiles, min_hits=args.min_hits)
