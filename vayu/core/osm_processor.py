"""
VAYU Engine — OSM Processor (Core Module)
===========================================
Overpass API queries for road + landuse + building extraction.
Complements ``vayu/jobs/process_osm.py`` (the CLI batch tool) by providing
reusable query builders and geometry helpers for the refresh pipeline.

ERD Section 4 — Road Data Layers.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from dataclasses import dataclass

import requests

log = logging.getLogger("vayu.osm_processor")

OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT = 180

# ---------------------------------------------------------------------------
# Region definitions (mirrors process_osm.py)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Region:
    name: str
    south: float
    west: float
    north: float
    east: float


REGIONS: dict[str, Region] = {
    # Bali
    "bali": Region("bali", -8.78, 115.10, -8.55, 115.30),
    "bali-badung": Region("bali", -8.85, 115.05, -8.55, 115.20),
    "bali-gianyar": Region("bali", -8.60, 115.25, -8.35, 115.45),
    "bali-karangasem": Region("bali", -8.55, 115.40, -8.30, 115.72),
    "bali-klungkung": Region("bali", -8.60, 115.35, -8.45, 115.50),
    "bali-tabanan": Region("bali", -8.65, 115.00, -8.35, 115.18),
    "bali-bangli": Region("bali", -8.50, 115.30, -8.25, 115.50),
    "bali-jembrana": Region("bali", -8.50, 114.43, -8.20, 114.85),
    # Jawa
    "jakarta": Region("jakarta", -6.30, 106.75, -6.10, 106.95),
    "bandung": Region("bandung", -6.95, 107.57, -6.87, 107.67),
    "surabaya": Region("surabaya", -7.33, 112.70, -7.23, 112.80),
    "semarang": Region("semarang", -7.02, 110.37, -6.94, 110.47),
    "yogyakarta": Region("yogyakarta", -7.82, 110.34, -7.74, 110.42),
    "solo": Region("solo", -7.60, 110.79, -7.53, 110.86),
    "malang": Region("malang", -8.00, 112.60, -7.94, 112.66),
    # Sulawesi
    "sulsel": Region("sulsel", -5.60, 119.25, -2.80, 120.65),
    "sulbar": Region("sulbar", -3.60, 118.70, -1.40, 119.45),
    "sulteng": Region("sulteng", -2.10, 119.60, 0.90, 123.40),
    "gorontalo": Region("gorontalo", 0.20, 121.80, 0.95, 123.15),
    "sulut": Region("sulut", 0.30, 123.20, 1.65, 125.30),
    "sultra": Region("sultra", -5.55, 121.30, -3.00, 124.10),
}


INCLUDED_HIGHWAY_CLASSES = {
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified", "residential",
    "living_street", "service",
}


# ---------------------------------------------------------------------------
# Region detection from a lat/lon point
# ---------------------------------------------------------------------------

def detect_region(lat: float, lon: float) -> str:
    """Detect region from coordinates (bounding-box match)."""
    if -8.85 <= lat <= -8.06 and 114.43 <= lon <= 115.71:
        return "bali"
    if -6.50 <= lat <= -6.08 and 106.60 <= lon <= 107.10:
        return "jakarta"
    if -7.02 <= lat <= -6.82 and 107.45 <= lon <= 107.77:
        return "bandung"
    if -7.40 <= lat <= -7.15 and 112.55 <= lon <= 112.85:
        return "surabaya"
    if -7.10 <= lat <= -6.90 and 110.30 <= lon <= 110.50:
        return "semarang"
    if -7.87 <= lat <= -7.72 and 110.30 <= lon <= 110.50:
        return "yogyakarta"
    if -7.62 <= lat <= -7.50 and 110.75 <= lon <= 110.90:
        return "solo"
    if -8.05 <= lat <= -7.90 and 112.58 <= lon <= 112.68:
        return "malang"
    if -5.60 <= lat <= -2.80 and 119.25 <= lon <= 120.65:
        return "sulsel"
    if -3.60 <= lat <= -1.40 and 118.70 <= lon <= 119.45:
        return "sulbar"
    if -2.10 <= lat <= 0.90 and 119.60 <= lon <= 123.40:
        return "sulteng"
    if 0.20 <= lat <= 0.95 and 121.80 <= lon <= 123.15:
        return "gorontalo"
    if 0.30 <= lat <= 1.65 and 123.20 <= lon <= 125.30:
        return "sulut"
    if -5.55 <= lat <= -3.00 and 121.30 <= lon <= 124.10:
        return "sultra"
    return "unknown"


# ---------------------------------------------------------------------------
# Overpass query builders
# ---------------------------------------------------------------------------

def build_road_query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"{south},{west},{north},{east}"
    classes = "|".join(INCLUDED_HIGHWAY_CLASSES)
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
(way["highway"~"^({classes})$"]({bbox}););
out body; >; out skel qt;
"""


def build_landuse_query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}][maxsize:536870912];
(
  way["landuse"]({bbox});
  way["natural"~"wood|tree_row|grassland|wetland|water"]({bbox});
  way["leisure"~"park|garden"]({bbox});
);
out body; >; out skel qt;
"""


# ---------------------------------------------------------------------------
# Overpass caller (with retry + adaptive tiling)
# ---------------------------------------------------------------------------

def query_overpass(query: str, label: str = "") -> dict:
    """Send query to Overpass API with retry."""
    for attempt in range(3):
        try:
            log.info("Querying Overpass%s (attempt %d)...", f" ({label})" if label else "", attempt + 1)
            resp = requests.post(
                OVERPASS_API_URL,
                data={"data": query},
                timeout=OVERPASS_TIMEOUT + 30,
            )
            resp.raise_for_status()
            data = resp.json()
            log.info("  → %d elements", len(data.get("elements", [])))
            return data
        except requests.exceptions.HTTPError:
            if resp.status_code == 429:
                wait = 30 * (attempt + 1)
                log.warning("  Rate limited, waiting %ds...", wait)
                time.sleep(wait)
            elif resp.status_code == 504 and attempt < 2:
                log.warning("  Timeout 504, retrying...")
                time.sleep(10)
            else:
                raise
        except requests.exceptions.ReadTimeout:
            if attempt < 2:
                time.sleep(10)
                continue
            raise
    raise RuntimeError(f"Overpass failed after 3 attempts ({label})")


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def build_node_index(elements: list[dict]) -> dict[int, tuple[float, float]]:
    """Build node ID → (lon, lat) lookup."""
    return {
        e["id"]: (e["lon"], e["lat"])
        for e in elements
        if e["type"] == "node" and "lon" in e and "lat" in e
    }


def way_to_coords(way: dict, nodes: dict[int, tuple[float, float]]) -> list[tuple[float, float]]:
    """Convert OSM way to list of (lon, lat) coordinate pairs."""
    coords = []
    for nid in way.get("nodes", []):
        if nid in nodes:
            coords.append(nodes[nid])
    return coords


# ---------------------------------------------------------------------------
# Road segment fetcher from Supabase
# ---------------------------------------------------------------------------

def fetch_nearby_roads(
    lat: float, lon: float, radius_m: int = 500, limit: int = 20,
) -> list[dict]:
    """
    Fetch road segments near a point from Supabase via PostgREST.
    Uses the ``find_nearby_roads`` RPC function.
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return []

    try:
        resp = requests.post(
            f"{url}/rest/v1/rpc/find_nearby_roads",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={"lat": lat, "lon": lon, "radius_m": radius_m, "max_results": limit},
            timeout=15,
        )
        if resp.status_code != 200:
            log.error("find_nearby_roads RPC failed: %s", resp.status_code)
            return []
        return resp.json()
    except Exception as exc:
        log.warning("fetch_nearby_roads error: %s", exc)
        return []
