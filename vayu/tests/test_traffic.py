"""
VAYU Engine — Traffic Estimation Tests
========================================
Validates OSM heuristic, diurnal modifiers, and calibration logic.
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.traffic import (
    estimate_base_traffic,
    get_diurnal_multiplier,
    compute_calibration_factor,
    estimate_traffic_volume,
    TomTomFlowResult,
    TRAFFIC_BASE,
    HOURLY_MULTIPLIER,
)
from core.cultural_calendar import (
    get_cultural_modifier,
    CulturalModifier,
    NYEPI_DATES,
    LEBARAN_DATES,
)
from datetime import datetime


class TestBaseTraffic:
    def test_motorway_highest(self):
        assert estimate_base_traffic("motorway") == 2000

    def test_residential(self):
        assert estimate_base_traffic("residential") == 100

    def test_footway_zero(self):
        assert estimate_base_traffic("footway") == 0

    def test_unknown_fallback(self):
        assert estimate_base_traffic("imaginary_road") == 50

    def test_lane_adjustment(self):
        base_2 = estimate_base_traffic("primary", lanes=2)
        base_4 = estimate_base_traffic("primary", lanes=4)
        assert base_4 > base_2


class TestDiurnalMultiplier:
    def test_peak_morning(self):
        # Hour 8 should be high (1.40)
        assert get_diurnal_multiplier(8) == 1.40

    def test_peak_evening(self):
        # Hour 18 should be highest (1.60)
        assert get_diurnal_multiplier(18) == 1.60

    def test_nighttime_low(self):
        # Hour 2 should be very low
        assert get_diurnal_multiplier(2) < 0.15

    def test_all_hours_covered(self):
        for h in range(24):
            m = get_diurnal_multiplier(h)
            assert 0.0 < m <= 2.0


class TestCulturalModifier:
    def test_normal_day(self):
        dt = datetime(2025, 6, 15, 12, 0)
        mod = get_cultural_modifier(dt, "bali")
        assert mod.event is None
        assert mod.traffic_multiplier == 1.0
        assert mod.diurnal_multiplier > 0

    def test_nyepi_bali(self):
        dt = datetime(2025, 3, 29, 12, 0)
        mod = get_cultural_modifier(dt, "bali")
        assert mod.event == "Nyepi"
        assert mod.combined == 0.0

    def test_nyepi_jakarta_no_effect(self):
        dt = datetime(2025, 3, 29, 12, 0)
        mod = get_cultural_modifier(dt, "jakarta")
        assert mod.event != "Nyepi"

    def test_lebaran(self):
        # Lebaran 2025: March 31
        dt = datetime(2025, 3, 31, 12, 0)
        mod = get_cultural_modifier(dt, "jakarta")
        assert mod.event == "Lebaran"
        assert mod.traffic_multiplier == 3.5

    def test_mudik_puncak(self):
        # H-1 of Lebaran 2025 (March 30)
        dt = datetime(2025, 3, 30, 12, 0)
        mod = get_cultural_modifier(dt, "jakarta")
        assert mod.event == "Mudik Puncak"
        assert mod.traffic_multiplier == 4.2

    def test_new_year(self):
        dt = datetime(2025, 1, 1, 0, 0)
        mod = get_cultural_modifier(dt, "surabaya")
        assert mod.event == "Tahun Baru"
        assert mod.traffic_multiplier == 2.8


class TestCalibrationFactor:
    def test_no_tomtom_default(self):
        factor = compute_calibration_factor(1000, None)
        assert factor == 1.0

    def test_normal_flow(self):
        flow = TomTomFlowResult(free_flow_speed=60, current_speed=55, congestion_ratio=0.92)
        factor = compute_calibration_factor(1000, flow)
        assert factor == 1.0

    def test_moderate_congestion(self):
        flow = TomTomFlowResult(free_flow_speed=60, current_speed=36, congestion_ratio=0.6)
        factor = compute_calibration_factor(1000, flow)
        assert 1.0 < factor < 2.0

    def test_heavy_congestion(self):
        flow = TomTomFlowResult(free_flow_speed=60, current_speed=18, congestion_ratio=0.3)
        factor = compute_calibration_factor(1000, flow)
        assert factor > 1.5


class TestEstimateTrafficVolume:
    def test_basic(self):
        vol = estimate_traffic_volume("primary", lanes=2, hour=12)
        assert vol > 0

    def test_nighttime_lower(self):
        vol_day = estimate_traffic_volume("primary", lanes=2, hour=12)
        vol_night = estimate_traffic_volume("primary", lanes=2, hour=2)
        assert vol_night < vol_day

    def test_cultural_modifier_effect(self):
        vol_normal = estimate_traffic_volume("primary", lanes=2, hour=12, cultural_modifier=1.0)
        vol_event = estimate_traffic_volume("primary", lanes=2, hour=12, cultural_modifier=3.5)
        assert vol_event > vol_normal
