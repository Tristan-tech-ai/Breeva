"""
VAYU Engine — Verified Local Contributor System (Stage 12.4)
=============================================================
Implements ERD 10.2 Tier 3: Verified Local Contributors.

Tier progression:
  Tier 0 (Default)  → No data collected, benefits from community data
  Tier 1 (Passive)  → On-device map-matching, speed→way_id only
  Tier 2 (Active)   → Tier 1 + manual AQI reports + off-road traces
  Tier 3 (Verified) → Tier 2 + local verification → trusted data source

Verified contributors get:
  - Ghost Paths they report are promoted faster (3→2 user threshold)
  - "Local Expert" badge
  - Data quality weight 2× for calibration
  - Priority access to new features

Verification methods:
  - Consistent contributions in same region for ≥30 days
  - ≥50 contributions in verified region
  - No anomalous data flags
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

log = logging.getLogger("vayu.ml.contributor_system")


@dataclass
class ContributorProfile:
    session_id: str
    region: str
    tier: int  # 0-3
    total_contributions: int
    region_contributions: int
    first_contribution: str | None
    last_contribution: str | None
    days_active: int
    anomaly_flags: int
    is_eligible_for_upgrade: bool
    data_weight: float  # 1.0 default, 2.0 for verified


# Thresholds for tier promotion
TIER_1_MIN_CONTRIBUTIONS = 5
TIER_2_MIN_CONTRIBUTIONS = 20
TIER_3_MIN_CONTRIBUTIONS = 50
TIER_3_MIN_DAYS_ACTIVE = 30
TIER_3_MAX_ANOMALIES = 2


def fetch_contributor_stats(
    session_id: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """
    Fetch aggregated contribution stats per session_id from Supabase.
    Groups by session_id and region.
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing Supabase credentials")
        return []

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    params: dict[str, str] = {
        "select": "session_id,contributed_at,is_off_road,speed_kmh",
        "order": "contributed_at.asc",
        "limit": str(limit),
    }
    if session_id:
        params["session_id"] = f"eq.{session_id}"

    try:
        resp = requests.get(
            f"{url}/rest/v1/vayu_contributions",
            headers=headers,
            params=params,
            timeout=15,
        )
        if resp.status_code != 200:
            log.error("Failed to fetch contributions: %s", resp.status_code)
            return []
        return resp.json()
    except Exception as exc:
        log.error("Fetch error: %s", exc)
        return []


def evaluate_contributor(
    session_id: str,
    contributions: list[dict],
    region: str = "unknown",
) -> ContributorProfile:
    """Evaluate a contributor's tier based on their contribution history."""
    if not contributions:
        return ContributorProfile(
            session_id=session_id,
            region=region,
            tier=0,
            total_contributions=0,
            region_contributions=0,
            first_contribution=None,
            last_contribution=None,
            days_active=0,
            anomaly_flags=0,
            is_eligible_for_upgrade=False,
            data_weight=1.0,
        )

    # Parse dates
    dates: list[datetime] = []
    anomaly_count = 0
    for c in contributions:
        ts = c.get("contributed_at", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            dates.append(dt)
        except (ValueError, AttributeError):
            pass

        # Anomaly detection: unrealistic speed
        speed = c.get("speed_kmh")
        if speed is not None and (speed > 200 or speed < 0):
            anomaly_count += 1

    first = min(dates).isoformat() if dates else None
    last = max(dates).isoformat() if dates else None

    # Calculate unique active days
    unique_days = len({d.date() for d in dates})

    total = len(contributions)
    region_count = total  # Simplified — in production, filter by geo-region

    # Determine tier
    tier = 0
    if total >= TIER_1_MIN_CONTRIBUTIONS:
        tier = 1
    if total >= TIER_2_MIN_CONTRIBUTIONS:
        tier = 2
    if (
        total >= TIER_3_MIN_CONTRIBUTIONS
        and unique_days >= TIER_3_MIN_DAYS_ACTIVE
        and anomaly_count <= TIER_3_MAX_ANOMALIES
    ):
        tier = 3

    # Check if eligible for next tier upgrade
    eligible = False
    if tier < 3:
        next_threshold = {0: TIER_1_MIN_CONTRIBUTIONS, 1: TIER_2_MIN_CONTRIBUTIONS, 2: TIER_3_MIN_CONTRIBUTIONS}
        needed = next_threshold.get(tier, 999)
        eligible = total >= needed * 0.8  # 80% of next threshold

    # Data weight based on tier
    weight_map = {0: 1.0, 1: 1.0, 2: 1.2, 3: 2.0}

    return ContributorProfile(
        session_id=session_id,
        region=region,
        tier=tier,
        total_contributions=total,
        region_contributions=region_count,
        first_contribution=first,
        last_contribution=last,
        days_active=unique_days,
        anomaly_flags=anomaly_count,
        is_eligible_for_upgrade=eligible,
        data_weight=weight_map.get(tier, 1.0),
    )


def batch_evaluate_contributors() -> list[ContributorProfile]:
    """Evaluate all active contributors and return their profiles."""
    contributions = fetch_contributor_stats()
    if not contributions:
        return []

    # Group by session_id
    groups: dict[str, list[dict]] = {}
    for c in contributions:
        sid = c.get("session_id", "")
        if sid:
            groups.setdefault(sid, []).append(c)

    profiles: list[ContributorProfile] = []
    tier_counts = {0: 0, 1: 0, 2: 0, 3: 0}

    for sid, contribs in groups.items():
        profile = evaluate_contributor(sid, contribs)
        profiles.append(profile)
        tier_counts[profile.tier] = tier_counts.get(profile.tier, 0) + 1

    log.info(
        "Evaluated %d contributors: T0=%d, T1=%d, T2=%d, T3=%d",
        len(profiles),
        tier_counts[0], tier_counts[1], tier_counts[2], tier_counts[3],
    )

    return profiles


def get_ghost_path_threshold(contributor_tier: int) -> int:
    """
    Get the minimum user threshold for ghost path promotion.
    Verified contributors (Tier 3) need fewer users to promote a path.
    """
    if contributor_tier >= 3:
        return 2   # Verified: only 2 users needed (instead of 3)
    return 3       # Default: 3 users for candidate status


def get_data_weight(contributor_tier: int) -> float:
    """Get the data quality weight multiplier for a contributor tier."""
    return {0: 1.0, 1: 1.0, 2: 1.2, 3: 2.0}.get(contributor_tier, 1.0)


def run() -> None:
    """CLI entry point — evaluate all contributors."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    log.info("=== Verified Local Contributor System ===")

    profiles = batch_evaluate_contributors()
    for p in profiles[:10]:
        log.info(
            "  %s: Tier %d | %d contributions | %d days | weight=%.1f%s",
            p.session_id[:12], p.tier, p.total_contributions,
            p.days_active, p.data_weight,
            " [VERIFIED]" if p.tier >= 3 else "",
        )

    verified = [p for p in profiles if p.tier >= 3]
    log.info("Total verified (Tier 3): %d / %d", len(verified), len(profiles))


if __name__ == "__main__":
    run()
