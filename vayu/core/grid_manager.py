"""
VAYU Engine — H3 Grid Manager
==============================
Manages hexagonal grid tiling via Uber H3 and UPSERTs computed AQI
tiles to the Supabase ``aqi_grid`` table.

ERD Section 11.5 — Resolution 9/11/12 adaptive.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Sequence

import h3
import requests

log = logging.getLogger("vayu.grid_manager")

# ---------------------------------------------------------------------------
# H3 resolution strategy (ERD 11.5)
#   Res 9  → ~174m edge → coarse coverage, sparse areas
#   Res 11 → ~25m edge  → urban dense (MVP default)
#   Res 12 → ~9.4m edge → future crowdsource-rich
# ---------------------------------------------------------------------------

DEFAULT_RESOLUTION = 11  # ~25m edge for MVP


@dataclass
class AQITile:
    tile_id: str      # H3 index hex string
    lat: float
    lon: float
    aqi: int
    pm25: float
    pm10: float
    no2: float
    co: float
    o3: float
    confidence: float
    layer_source: int  # 1=Mode A, 2=Mode B, 3=Mode B+ML
    region: str
    valid_until: str   # ISO 8601
    stability_class: str | None = None


# ---------------------------------------------------------------------------
# H3 helpers
# ---------------------------------------------------------------------------

def lat_lon_to_h3(lat: float, lon: float, resolution: int = DEFAULT_RESOLUTION) -> str:
    """Convert lat/lon to H3 hex index."""
    return h3.latlng_to_cell(lat, lon, resolution)


def h3_to_center(h3_index: str) -> tuple[float, float]:
    """Get center (lat, lon) of an H3 cell."""
    lat, lon = h3.cell_to_latlng(h3_index)
    return lat, lon


def get_h3_ring(lat: float, lon: float, radius_k: int = 1,
                resolution: int = DEFAULT_RESOLUTION) -> list[str]:
    """Get H3 cells in a ring around a point (k-ring)."""
    center = lat_lon_to_h3(lat, lon, resolution)
    return list(h3.grid_disk(center, radius_k))


def get_bbox_h3_cells(
    south: float, west: float, north: float, east: float,
    resolution: int = DEFAULT_RESOLUTION,
) -> list[str]:
    """Get all H3 cells covering a bounding box (approximate)."""
    # Sample grid points and collect unique H3 cells
    step_lat = (north - south) / max(1, int((north - south) * 400))
    step_lon = (east - west) / max(1, int((east - west) * 400))

    cells: set[str] = set()
    lat = south
    while lat <= north:
        lon = west
        while lon <= east:
            cells.add(lat_lon_to_h3(lat, lon, resolution))
            lon += step_lon
        lat += step_lat
    return list(cells)


# ---------------------------------------------------------------------------
# Supabase UPSERT (REST API — self-contained, no SDK)
# ---------------------------------------------------------------------------

def _get_supabase() -> tuple[str, dict[str, str]]:
    """Return (api_base, headers) for Supabase REST API."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return f"{url}/rest/v1", {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def upsert_tiles(tiles: Sequence[AQITile], batch_size: int = 200) -> int:
    """
    UPSERT AQI tiles to Supabase ``aqi_grid`` table.

    Uses ``on_conflict=tile_id`` with merge-duplicates.
    Mode B results (layer_source=2) always overwrite Mode A (layer_source=1).
    """
    if not tiles:
        return 0

    api_base, headers = _get_supabase()
    total = 0

    for i in range(0, len(tiles), batch_size):
        batch = tiles[i: i + batch_size]
        rows = []
        for t in batch:
            rows.append({
                "tile_id": t.tile_id,
                "lat": t.lat,
                "lon": t.lon,
                "aqi": t.aqi,
                "pm25": t.pm25,
                "pm10": t.pm10,
                "no2": t.no2,
                "co": t.co,
                "o3": t.o3,
                "confidence": t.confidence,
                "layer_source": t.layer_source,
                "region": t.region,
                "valid_until": t.valid_until,
            })

        resp = requests.post(
            f"{api_base}/aqi_grid?on_conflict=tile_id",
            headers={**headers, "Prefer": "resolution=merge-duplicates"},
            json=rows,
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            log.error("UPSERT failed (batch %d): %s %s",
                      i // batch_size, resp.status_code, resp.text[:300])
            continue
        total += len(batch)
        log.debug("UPSERTed %d/%d tiles", total, len(tiles))

    return total


def fetch_hot_tiles(min_hit_count: int = 5, limit: int = 500) -> list[dict]:
    """
    Query hot tiles from ``aqi_grid`` ordered by hit_count desc.
    These are tiles that users request most frequently.
    """
    api_base, headers = _get_supabase()
    resp = requests.get(
        f"{api_base}/aqi_grid",
        headers=headers,
        params={
            "select": "tile_id,lat,lon,region,hit_count,layer_source,valid_until",
            "order": "hit_count.desc",
            "limit": str(limit),
            "hit_count": f"gte.{min_hit_count}",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        log.error("Failed to fetch hot tiles: %s %s", resp.status_code, resp.text[:200])
        return []
    return resp.json()


def fetch_expiring_tiles(minutes_until_expiry: int = 15) -> list[dict]:
    """Fetch tiles that will expire within N minutes."""
    api_base, headers = _get_supabase()
    cutoff = datetime.now(timezone.utc).isoformat()
    resp = requests.get(
        f"{api_base}/aqi_grid",
        headers=headers,
        params={
            "select": "tile_id,lat,lon,region,layer_source",
            "valid_until": f"lte.{cutoff}",
            "order": "hit_count.desc",
            "limit": "200",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        log.error("Failed to fetch expiring tiles: %s", resp.status_code)
        return []
    return resp.json()
