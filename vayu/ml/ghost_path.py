"""
VAYU Engine — Ghost Path Detection (Stage 11.4)
=================================================
Detects undocumented local routes ("ghost paths") from crowdsource
contribution traces that fail map-matching (off-road segments).

ERD Section 6.3:
  - Users' map-match fails → marked off-road → upload geohash level 9 (~5m)
  - If ≥3 users traverse same cluster in 30 days → candidate path
  - If ≥10 users confirm → verified, AQI assigned with vegetation bonus

Ghost paths represent hidden walking routes not in OSM (gang/jalan tikus,
shortcuts through kampung, park paths, etc.)
"""

from __future__ import annotations

import logging
import math
import os
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.ml.ghost_path")

GEOHASH_PRECISION = 9  # ~5m accuracy
MIN_USERS_CANDIDATE = 3
MIN_USERS_VERIFIED = 10
CLUSTER_RADIUS_M = 20  # Merge geohashes within 20m
LOOKBACK_DAYS = 30


@dataclass
class GhostPathCandidate:
    geohash_trail: list[str]
    contributor_count: int
    sessions: set[str]
    region: str
    avg_lat: float
    avg_lon: float
    is_candidate: bool
    is_verified: bool
    estimated_aqi: int | None = None


@dataclass
class GhostPath:
    id: int | None
    geohash_trail: list[str]
    contributor_count: int
    is_verified: bool
    avg_aqi: float | None
    region: str
    created_at: str
    last_confirmed_at: str


def _geohash_to_latlon(gh: str) -> tuple[float, float]:
    """Decode geohash to (lat, lon) center point."""
    # Simplified geohash decoder
    base32 = "0123456789bcdefghjkmnpqrstuvwxyz"
    is_lon = True
    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]

    for char in gh:
        idx = base32.index(char)
        for bit in range(4, -1, -1):
            if is_lon:
                mid = (lon_range[0] + lon_range[1]) / 2
                if idx & (1 << bit):
                    lon_range[0] = mid
                else:
                    lon_range[1] = mid
            else:
                mid = (lat_range[0] + lat_range[1]) / 2
                if idx & (1 << bit):
                    lat_range[0] = mid
                else:
                    lat_range[1] = mid
            is_lon = not is_lon

    lat = (lat_range[0] + lat_range[1]) / 2
    lon = (lon_range[0] + lon_range[1]) / 2
    return lat, lon


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_offroad_contributions(lookback_days: int = LOOKBACK_DAYS) -> list[dict]:
    """
    Fetch off-road contributions from Supabase vayu_contributions table.
    Only contributions with is_off_road=true and off_road_geohash set.
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing Supabase credentials")
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

    try:
        resp = requests.get(
            f"{url}/rest/v1/vayu_contributions",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            params={
                "select": "session_id,off_road_geohash,contributed_at",
                "is_off_road": "eq.true",
                "off_road_geohash": "not.is.null",
                "contributed_at": f"gte.{cutoff}",
                "order": "contributed_at",
                "limit": "10000",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            log.error("Fetch contributions failed: %s", resp.status_code)
            return []
        return resp.json()
    except Exception as exc:
        log.error("Failed to fetch off-road contributions: %s", exc)
        return []


def cluster_geohashes(
    contributions: list[dict],
) -> list[GhostPathCandidate]:
    """
    Cluster off-road geohashes into potential ghost paths.

    Algorithm:
    1. Group geohashes by proximity (within CLUSTER_RADIUS_M)
    2. Count unique sessions per cluster
    3. Clusters with ≥3 unique sessions → candidate
    4. Clusters with ≥10 unique sessions → verified
    """
    if not contributions:
        return []

    # Group by geohash (exact match first)
    gh_sessions: dict[str, set[str]] = {}
    for c in contributions:
        gh = c.get("off_road_geohash", "")
        session = c.get("session_id", "")
        if gh and session:
            gh_sessions.setdefault(gh, set()).add(session)

    # Build adjacency clusters by proximity
    geohashes = list(gh_sessions.keys())
    positions = {gh: _geohash_to_latlon(gh) for gh in geohashes}

    visited: set[str] = set()
    clusters: list[list[str]] = []

    for gh in geohashes:
        if gh in visited:
            continue
        cluster = [gh]
        visited.add(gh)
        queue = [gh]

        while queue:
            current = queue.pop(0)
            clat, clon = positions[current]
            for other in geohashes:
                if other in visited:
                    continue
                olat, olon = positions[other]
                if _haversine_m(clat, clon, olat, olon) <= CLUSTER_RADIUS_M:
                    cluster.append(other)
                    visited.add(other)
                    queue.append(other)

        clusters.append(cluster)

    # Convert clusters to candidates
    candidates: list[GhostPathCandidate] = []
    for cluster_ghs in clusters:
        all_sessions: set[str] = set()
        for gh in cluster_ghs:
            all_sessions.update(gh_sessions.get(gh, set()))

        if len(all_sessions) < MIN_USERS_CANDIDATE:
            continue

        # Compute center point
        lats = [positions[gh][0] for gh in cluster_ghs]
        lons = [positions[gh][1] for gh in cluster_ghs]
        avg_lat = sum(lats) / len(lats)
        avg_lon = sum(lons) / len(lons)

        # Detect region
        from core.osm_processor import detect_region
        region = detect_region(avg_lat, avg_lon)

        candidate = GhostPathCandidate(
            geohash_trail=sorted(cluster_ghs),
            contributor_count=len(all_sessions),
            sessions=all_sessions,
            region=region,
            avg_lat=round(avg_lat, 6),
            avg_lon=round(avg_lon, 6),
            is_candidate=len(all_sessions) >= MIN_USERS_CANDIDATE,
            is_verified=len(all_sessions) >= MIN_USERS_VERIFIED,
        )
        candidates.append(candidate)

    log.info(
        "Clustered %d geohashes into %d candidates (%d verified)",
        len(geohashes), len(candidates),
        sum(1 for c in candidates if c.is_verified),
    )
    return candidates


def estimate_ghost_path_aqi(candidate: GhostPathCandidate) -> int:
    """
    Estimate AQI for a ghost path.
    Ghost paths typically have better AQ (no vehicle traffic + vegetation).
    """
    # Get baseline AQI from VAYU for the center point
    try:
        resp = requests.get(
            "https://breeva.site/api/vayu/aqi",
            params={"lat": candidate.avg_lat, "lon": candidate.avg_lon},
            timeout=10,
        )
        if resp.status_code == 200:
            baseline_aqi = resp.json().get("data", {}).get("aqi", 30)
        else:
            baseline_aqi = 30
    except Exception:
        baseline_aqi = 30

    # Ghost path bonus: no vehicles + likely vegetation
    # Apply 20-30% reduction
    ghost_bonus = 0.75  # 25% reduction
    return max(5, round(baseline_aqi * ghost_bonus))


def upsert_ghost_paths(candidates: list[GhostPathCandidate]) -> int:
    """Upsert verified ghost paths to Supabase ghost_paths table."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for c in candidates:
        if not c.is_candidate:
            continue

        aqi = estimate_ghost_path_aqi(c)
        c.estimated_aqi = aqi

        rows.append({
            "geohash_trail": c.geohash_trail,
            "contributor_count": c.contributor_count,
            "is_verified": c.is_verified,
            "avg_aqi": aqi,
            "region": c.region,
            "geom": f"SRID=4326;POINT({c.avg_lon} {c.avg_lat})",
            "last_confirmed_at": now,
        })

    if not rows:
        return 0

    try:
        resp = requests.post(
            f"{url}/rest/v1/ghost_paths",
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
            log.info("Upserted %d ghost paths", len(rows))
            return len(rows)
        else:
            log.error("Ghost path upsert failed: %s", resp.status_code)
            return 0
    except Exception as exc:
        log.error("Ghost path upsert error: %s", exc)
        return 0


def run() -> None:
    """Main ghost path detection pipeline."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("=== Ghost Path Detection ===")

    # 1. Fetch off-road contributions
    contributions = fetch_offroad_contributions()
    log.info("Found %d off-road contributions", len(contributions))

    if not contributions:
        log.info("No off-road contributions — nothing to process")
        return

    # 2. Cluster and detect candidates
    candidates = cluster_geohashes(contributions)

    # 3. Upsert to database
    count = upsert_ghost_paths(candidates)
    log.info("Ghost path detection complete: %d paths upserted", count)


if __name__ == "__main__":
    run()
