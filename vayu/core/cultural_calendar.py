"""
VAYU Engine — Cultural Calendar Module (Python)
=================================================
Detects Indonesian cultural events and returns traffic modifiers.
Mirrors the TypeScript implementation in src/lib/vayu/cultural-calendar.ts.

ERD Section 8.1, 8.1.1, 8.2
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

# ---------------------------------------------------------------------------
# Nyepi dates (Saka lunar calendar — hardcoded MVP)
# ---------------------------------------------------------------------------

NYEPI_DATES: dict[int, str] = {
    2025: "2025-03-29",
    2026: "2026-03-19",
    2027: "2027-03-07",
    2028: "2028-03-26",
    2029: "2029-03-15",
}

# ---------------------------------------------------------------------------
# Lebaran (Hari Raya Idul Fitri) — hardcoded estimates
# ---------------------------------------------------------------------------

LEBARAN_DATES: dict[int, str] = {
    2025: "2025-03-31",
    2026: "2026-03-21",
    2027: "2027-03-10",
    2028: "2028-02-27",
    2029: "2029-02-15",
}

# ---------------------------------------------------------------------------
# Galungan reference (Rabu Kliwon Dungulan, every 210 days)
# ---------------------------------------------------------------------------

GALUNGAN_REFERENCE = date(2025, 1, 15)
PAWUKON_CYCLE = 210

# ---------------------------------------------------------------------------
# Diurnal hourly traffic modifiers (ERD 8.2)
# ---------------------------------------------------------------------------

HOURLY_TRAFFIC: dict[int, float] = {
    0: 0.15, 1: 0.10, 2: 0.08, 3: 0.08, 4: 0.12,
    5: 0.35, 6: 0.85, 7: 1.20, 8: 1.40, 9: 1.10,
    10: 0.90, 11: 0.95, 12: 1.15, 13: 1.10, 14: 0.85,
    15: 0.90, 16: 1.20, 17: 1.50, 18: 1.60, 19: 1.30,
    20: 1.10, 21: 0.80, 22: 0.55, 23: 0.30,
}


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class CulturalModifier:
    event: str | None
    traffic_multiplier: float
    diurnal_multiplier: float
    combined: float


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

def _is_nyepi(d: date) -> bool:
    """Check if date is during Nyepi (Bali only)."""
    nyepi = NYEPI_DATES.get(d.year)
    if not nyepi:
        return False
    return d.isoformat() == nyepi


def _get_lebaran_modifier(d: date) -> float | None:
    """
    Check if date falls within Lebaran window.
    H-3 to H-1: mudik puncak (4.2x)
    H+0 to H+2: Lebaran (3.5x)
    """
    lebaran_str = LEBARAN_DATES.get(d.year)
    if not lebaran_str:
        return None
    lebaran = date.fromisoformat(lebaran_str)
    diff = (d - lebaran).days
    if -3 <= diff <= -1:
        return 4.2  # Mudik puncak
    if 0 <= diff <= 2:
        return 3.5  # Lebaran
    return None


def _is_near_galungan(d: date) -> bool:
    """Check if date is near Galungan (Bali, pawukon 210-day cycle)."""
    diff_days = (d - GALUNGAN_REFERENCE).days
    mod = diff_days % PAWUKON_CYCLE
    if mod < 0:
        mod += PAWUKON_CYCLE
    # Galungan day (0-1) and Kuningan (10-11 days after)
    return mod <= 1 or 10 <= mod <= 11


def _is_new_year(d: date) -> bool:
    """Check if it's New Year's Eve or Day."""
    return (d.month == 12 and d.day == 31) or (d.month == 1 and d.day == 1)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_cultural_modifier(dt: datetime, region: str) -> CulturalModifier:
    """
    Get cultural + diurnal traffic modifier for a given time and region.
    Returns a combined multiplier (0.0 – ~6.7).
    0.0 = no traffic (Nyepi), 1.0 = normal baseline.
    """
    d = dt.date() if isinstance(dt, datetime) else dt
    hour = dt.hour if isinstance(dt, datetime) else 12
    diurnal = HOURLY_TRAFFIC.get(hour, 1.0)

    is_bali = region == "bali"

    # Nyepi: zero traffic (Bali only)
    if is_bali and _is_nyepi(d):
        return CulturalModifier(
            event="Nyepi",
            traffic_multiplier=0.0,
            diurnal_multiplier=diurnal,
            combined=0.0,
        )

    # Lebaran window (nationwide)
    lebaran_mod = _get_lebaran_modifier(d)
    if lebaran_mod is not None:
        event_name = "Mudik Puncak" if lebaran_mod >= 4.0 else "Lebaran"
        return CulturalModifier(
            event=event_name,
            traffic_multiplier=lebaran_mod,
            diurnal_multiplier=diurnal,
            combined=lebaran_mod * diurnal,
        )

    # Galungan/Kuningan (Bali only)
    if is_bali and _is_near_galungan(d):
        return CulturalModifier(
            event="Galungan/Kuningan",
            traffic_multiplier=1.6,
            diurnal_multiplier=diurnal,
            combined=1.6 * diurnal,
        )

    # New Year's Eve/Day (nationwide)
    if _is_new_year(d):
        return CulturalModifier(
            event="Tahun Baru",
            traffic_multiplier=2.8,
            diurnal_multiplier=diurnal,
            combined=2.8 * diurnal,
        )

    # Normal day
    return CulturalModifier(
        event=None,
        traffic_multiplier=1.0,
        diurnal_multiplier=diurnal,
        combined=diurnal,
    )


def get_diurnal_modifier(hour: int) -> float:
    """Get diurnal traffic modifier for a given hour (0-23)."""
    return HOURLY_TRAFFIC.get(hour % 24, 1.0)
