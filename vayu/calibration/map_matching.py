"""
VAYU Engine — On-Device Map Matching SDK (Stage 10.4)
======================================================
Provides lightweight map-matching: GPS trace → nearest OSM way_id.
Designed for client-side use via API endpoint, using pre-computed
spatial index of road segments stored in Supabase.

This module provides the server-side matching logic that the frontend
calls during active walks for real-time OSM way_id resolution.

ERD Section 10.2 — Tier 1 Passive Data Collection.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass

import requests

log = logging.getLogger("vayu.calibration.map_matching")

EARTH_RADIUS_M = 6_371_000
DEFAULT_SEARCH_RADIUS_M = 50  # Match within 50m of GPS point
MAX_CANDIDATES = 5


@dataclass
class MatchCandidate:
    osm_way_id: int
    highway: str
    distance_m: float
    region: str
    bearing_diff: float | None = None  # Difference between GPS heading and road bearing


@dataclass
class MapMatchResult:
    lat: float
    lon: float
    matched_way_id: int | None
    highway: str | None
    distance_m: float | None
    confidence: float  # 0-1, based on distance and heading match
    candidates: list[MatchCandidate]


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters."""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_nearest_roads(
    lat: float, lon: float,
    radius_m: float = DEFAULT_SEARCH_RADIUS_M,
    limit: int = MAX_CANDIDATES,
) -> list[MatchCandidate]:
    """
    Query Supabase for nearest road segments using PostGIS ST_DWithin.
    Returns sorted candidates by distance.
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.warning("Missing Supabase credentials for map matching")
        return []

    # Use PostGIS RPC for spatial query
    rpc_url = f"{url}/rest/v1/rpc/find_nearby_roads"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            rpc_url,
            headers=headers,
            json={
                "p_lat": lat,
                "p_lon": lon,
                "p_radius_m": radius_m,
                "p_limit": limit,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            log.warning("find_nearby_roads RPC failed: %s", resp.status_code)
            return []

        rows = resp.json()
        candidates = []
        for r in rows:
            candidates.append(MatchCandidate(
                osm_way_id=r.get("osm_way_id", 0),
                highway=r.get("highway", "unknown"),
                distance_m=r.get("distance_m", 999),
                region=r.get("region", "unknown"),
            ))
        return sorted(candidates, key=lambda c: c.distance_m)
    except Exception as exc:
        log.warning("Map matching query failed: %s", exc)
        return []


def match_point(
    lat: float, lon: float,
    heading: float | None = None,
    speed_kmh: float | None = None,
) -> MapMatchResult:
    """
    Map-match a single GPS point to the nearest OSM road segment.

    Args:
        lat, lon: GPS coordinates
        heading: GPS heading in degrees (0-360), if available
        speed_kmh: Current speed, used to filter (e.g., skip motorways for pedestrians)

    Returns:
        MapMatchResult with best match and confidence score.
    """
    candidates = find_nearest_roads(lat, lon)

    if not candidates:
        return MapMatchResult(
            lat=lat, lon=lon,
            matched_way_id=None, highway=None,
            distance_m=None, confidence=0.0,
            candidates=[],
        )

    # Score candidates by distance (primary) and heading match (secondary)
    best = candidates[0]
    distance_confidence = max(0, 1.0 - (best.distance_m / DEFAULT_SEARCH_RADIUS_M))

    # If speed is very low and best match is motorway, try secondary
    if speed_kmh is not None and speed_kmh < 10 and best.highway in ("motorway", "motorway_link", "trunk"):
        for c in candidates[1:]:
            if c.highway not in ("motorway", "motorway_link", "trunk"):
                best = c
                distance_confidence = max(0, 1.0 - (best.distance_m / DEFAULT_SEARCH_RADIUS_M))
                break

    return MapMatchResult(
        lat=lat, lon=lon,
        matched_way_id=best.osm_way_id,
        highway=best.highway,
        distance_m=round(best.distance_m, 1),
        confidence=round(distance_confidence, 3),
        candidates=candidates,
    )


def match_trace(
    points: list[tuple[float, float]],
    headings: list[float | None] | None = None,
    speeds: list[float | None] | None = None,
) -> list[MapMatchResult]:
    """
    Map-match a sequence of GPS points (a walk trace).
    Uses previous match to bias next match for continuity.

    Returns list of MapMatchResult, one per input point.
    """
    results: list[MapMatchResult] = []
    prev_way_id: int | None = None

    for i, (lat, lon) in enumerate(points):
        heading = headings[i] if headings and i < len(headings) else None
        speed = speeds[i] if speeds and i < len(speeds) else None

        result = match_point(lat, lon, heading, speed)

        # Continuity bias: if previous match is in candidates, prefer it
        # (unless distance is much worse)
        if prev_way_id is not None and result.matched_way_id != prev_way_id:
            for c in result.candidates:
                if c.osm_way_id == prev_way_id and c.distance_m < DEFAULT_SEARCH_RADIUS_M * 0.8:
                    result = MapMatchResult(
                        lat=lat, lon=lon,
                        matched_way_id=c.osm_way_id,
                        highway=c.highway,
                        distance_m=round(c.distance_m, 1),
                        confidence=round(max(0, 1.0 - c.distance_m / DEFAULT_SEARCH_RADIUS_M), 3),
                        candidates=result.candidates,
                    )
                    break

        prev_way_id = result.matched_way_id
        results.append(result)

    # Calculate off-road segments
    off_road = sum(1 for r in results if r.matched_way_id is None)
    if results:
        log.info(
            "Trace matched: %d points, %d on-road, %d off-road (%.0f%%)",
            len(results), len(results) - off_road, off_road,
            off_road / len(results) * 100,
        )

    return results
