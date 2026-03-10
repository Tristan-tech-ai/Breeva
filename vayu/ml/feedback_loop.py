"""
VAYU Engine — Route Feedback Loop (Stage 12.2)
===============================================
Implements ERD 6.4: Self-improving engine from user route choices.

Implicit reinforcement:
  - User picks "cleanest air" route → completes without deviation → REINFORCE accuracy
  - User deviates from suggested route → PENALIZE segments with poor prediction
  - User submits negative rating → PENALIZE segments

Tracks per (osm_way_id, hour_bucket):
  - accuracy_score: running EMA of prediction quality (0.0 - 1.0)
  - positive_signals: count of reinforcements
  - negative_signals: count of penalties
  - last_updated: timestamp
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from math import atan2, cos, pi, radians, sin, sqrt

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

log = logging.getLogger("vayu.ml.feedback_loop")

# Exponential Moving Average alpha for accuracy updates
EMA_ALPHA = 0.15
# Deviation threshold: >100m from route = deviated
DEVIATION_THRESHOLD_M = 100
# Minimum walk length to generate signals
MIN_WALK_DISTANCE_M = 200


@dataclass
class FeedbackSignal:
    osm_way_id: int
    hour_bucket: int  # 0-23
    signal_type: str  # 'reinforce' | 'penalize'
    magnitude: float  # 0.0-1.0 (how strongly to adjust)
    reason: str


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two points."""
    R = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def detect_deviation(
    planned_points: list[dict],
    actual_points: list[dict],
    threshold_m: float = DEVIATION_THRESHOLD_M,
) -> tuple[bool, float]:
    """
    Check if user deviated from planned route.
    Returns (deviated: bool, max_deviation_m: float).
    """
    if not planned_points or not actual_points:
        return False, 0.0

    max_dev = 0.0
    deviated_count = 0

    for actual in actual_points:
        alat = actual.get("lat", 0)
        alng = actual.get("lng", 0)
        if not alat:
            continue

        # Find closest planned point
        min_dist = float("inf")
        for planned in planned_points:
            d = haversine_m(alat, alng, planned.get("lat", 0), planned.get("lng", 0))
            min_dist = min(min_dist, d)

        max_dev = max(max_dev, min_dist)
        if min_dist > threshold_m:
            deviated_count += 1

    # Deviated if >30% of actual points are off-route
    deviated = (deviated_count / max(len(actual_points), 1)) > 0.3
    return deviated, max_dev


def generate_feedback_signals(
    walk_data: dict,
) -> list[FeedbackSignal]:
    """
    Analyze a completed walk and generate feedback signals.

    walk_data expected keys:
      - planned_route_points: [{lat, lng}]  (original route suggestion)
      - actual_route_points: [{lat, lng, timestamp}]  (GPS trace)
      - route_segments: [{osm_way_id, predicted_aqi}]  (what VAYU predicted)
      - user_rating: int | None  (1-5 AQI rating, None if skipped)
      - distance_meters: float
      - completed: bool
    """
    signals: list[FeedbackSignal] = []

    planned = walk_data.get("planned_route_points", [])
    actual = walk_data.get("actual_route_points", [])
    segments = walk_data.get("route_segments", [])
    rating = walk_data.get("user_rating")
    distance = walk_data.get("distance_meters", 0)
    completed = walk_data.get("completed", False)

    if distance < MIN_WALK_DISTANCE_M or not segments:
        return signals

    # Determine hour bucket from walk timestamps
    hour_bucket = 12  # default noon
    if actual and actual[0].get("timestamp"):
        try:
            dt = datetime.fromisoformat(actual[0]["timestamp"].replace("Z", "+00:00"))
            hour_bucket = dt.hour
        except (ValueError, AttributeError):
            pass

    # Signal 1: Completion without deviation → reinforce
    deviated, max_dev = detect_deviation(planned, actual)

    if completed and not deviated:
        for seg in segments:
            way_id = seg.get("osm_way_id")
            if way_id:
                signals.append(FeedbackSignal(
                    osm_way_id=way_id,
                    hour_bucket=hour_bucket,
                    signal_type="reinforce",
                    magnitude=0.8,
                    reason="completed_no_deviation",
                ))
    elif deviated:
        for seg in segments:
            way_id = seg.get("osm_way_id")
            if way_id:
                signals.append(FeedbackSignal(
                    osm_way_id=way_id,
                    hour_bucket=hour_bucket,
                    signal_type="penalize",
                    magnitude=0.5,
                    reason=f"route_deviation_{max_dev:.0f}m",
                ))

    # Signal 2: User rating
    if rating is not None:
        for seg in segments:
            way_id = seg.get("osm_way_id")
            if not way_id:
                continue

            if rating >= 4:
                signals.append(FeedbackSignal(
                    osm_way_id=way_id,
                    hour_bucket=hour_bucket,
                    signal_type="reinforce",
                    magnitude=0.6,
                    reason=f"positive_rating_{rating}",
                ))
            elif rating <= 2:
                signals.append(FeedbackSignal(
                    osm_way_id=way_id,
                    hour_bucket=hour_bucket,
                    signal_type="penalize",
                    magnitude=0.7,
                    reason=f"negative_rating_{rating}",
                ))

    log.info(
        "Generated %d signals (reinforce=%d, penalize=%d)",
        len(signals),
        sum(1 for s in signals if s.signal_type == "reinforce"),
        sum(1 for s in signals if s.signal_type == "penalize"),
    )
    return signals


def apply_feedback_signals(signals: list[FeedbackSignal]) -> int:
    """
    Apply feedback signals to route_feedback table in Supabase.
    Uses EMA to update accuracy_score per (osm_way_id, hour_bucket).
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing Supabase credentials")
        return 0

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    applied = 0
    for signal in signals:
        try:
            # Fetch existing record
            resp = requests.get(
                f"{url}/rest/v1/route_feedback",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                params={
                    "osm_way_id": f"eq.{signal.osm_way_id}",
                    "hour_bucket": f"eq.{signal.hour_bucket}",
                    "select": "accuracy_score,positive_signals,negative_signals",
                    "limit": "1",
                },
                timeout=10,
            )

            if resp.status_code == 200 and resp.json():
                # Update existing
                existing = resp.json()[0]
                old_score = existing.get("accuracy_score", 0.5)
                target = 1.0 if signal.signal_type == "reinforce" else 0.0
                new_score = old_score + EMA_ALPHA * signal.magnitude * (target - old_score)
                new_score = max(0.0, min(1.0, new_score))

                update = {
                    "accuracy_score": round(new_score, 4),
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                }
                if signal.signal_type == "reinforce":
                    update["positive_signals"] = existing.get("positive_signals", 0) + 1
                else:
                    update["negative_signals"] = existing.get("negative_signals", 0) + 1

                requests.patch(
                    f"{url}/rest/v1/route_feedback",
                    headers=headers,
                    params={
                        "osm_way_id": f"eq.{signal.osm_way_id}",
                        "hour_bucket": f"eq.{signal.hour_bucket}",
                    },
                    json=update,
                    timeout=10,
                )
            else:
                # Insert new record
                init_score = 0.7 if signal.signal_type == "reinforce" else 0.3
                requests.post(
                    f"{url}/rest/v1/route_feedback",
                    headers={**headers, "Prefer": "return=minimal"},
                    json={
                        "osm_way_id": signal.osm_way_id,
                        "hour_bucket": signal.hour_bucket,
                        "accuracy_score": init_score,
                        "positive_signals": 1 if signal.signal_type == "reinforce" else 0,
                        "negative_signals": 0 if signal.signal_type == "reinforce" else 1,
                        "last_updated": datetime.now(timezone.utc).isoformat(),
                    },
                    timeout=10,
                )

            applied += 1
        except Exception as exc:
            log.warning("Failed to apply signal for way %d: %s", signal.osm_way_id, exc)

    log.info("Applied %d/%d feedback signals", applied, len(signals))
    return applied


def get_accuracy_modifier(osm_way_id: int, hour: int) -> float:
    """
    Get the accuracy modifier for a road segment at a given hour.
    Returns a multiplier (0.5–1.5) that adjusts AQI prediction confidence.
    Low accuracy_score → widen confidence interval.
    """
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return 1.0

    try:
        resp = requests.get(
            f"{url}/rest/v1/route_feedback",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            params={
                "osm_way_id": f"eq.{osm_way_id}",
                "hour_bucket": f"eq.{hour}",
                "select": "accuracy_score,positive_signals,negative_signals",
                "limit": "1",
            },
            timeout=5,
        )
        if resp.status_code == 200 and resp.json():
            row = resp.json()[0]
            score = row.get("accuracy_score", 0.5)
            total = row.get("positive_signals", 0) + row.get("negative_signals", 0)
            if total < 5:
                return 1.0  # Not enough data
            # Map score 0-1 to modifier 0.5-1.5
            return 0.5 + score
    except Exception:
        pass

    return 1.0


def run() -> None:
    """CLI demo — would be called from walk completion webhook."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Example walk data
    example = {
        "planned_route_points": [
            {"lat": -8.6785, "lng": 115.2623},
            {"lat": -8.6800, "lng": 115.2640},
        ],
        "actual_route_points": [
            {"lat": -8.6785, "lng": 115.2623, "timestamp": "2025-01-15T10:00:00Z"},
            {"lat": -8.6790, "lng": 115.2630, "timestamp": "2025-01-15T10:05:00Z"},
            {"lat": -8.6800, "lng": 115.2640, "timestamp": "2025-01-15T10:10:00Z"},
        ],
        "route_segments": [
            {"osm_way_id": 123456, "predicted_aqi": 65},
            {"osm_way_id": 123457, "predicted_aqi": 70},
        ],
        "user_rating": 4,
        "distance_meters": 300,
        "completed": True,
    }

    signals = generate_feedback_signals(example)
    for s in signals:
        log.info("  %s way=%d h=%d mag=%.1f reason=%s",
                 s.signal_type, s.osm_way_id, s.hour_bucket, s.magnitude, s.reason)

    if signals:
        apply_feedback_signals(signals)


if __name__ == "__main__":
    run()
