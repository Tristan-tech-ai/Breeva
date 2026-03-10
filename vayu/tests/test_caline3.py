"""
VAYU Engine — CALINE3 Dispersion Tests
========================================
Validates Gaussian line-source dispersion math, stability classification,
PM2.5→AQI conversion, and emission factors.
"""

import math
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.caline3 import (
    FLEET_AVG,
    AQI_BREAKPOINTS,
    RoadSegment,
    classify_stability,
    compute_dispersion,
    pm25_to_aqi,
    sigma_y,
    sigma_z,
    _haversine_m,
    _line_source_concentration,
)


class TestPM25ToAQI:
    def test_zero(self):
        assert pm25_to_aqi(0) == 0

    def test_good_range(self):
        assert pm25_to_aqi(6.0) == 25

    def test_moderate_edge(self):
        assert pm25_to_aqi(12.0) == 50

    def test_moderate(self):
        assert pm25_to_aqi(35.4) == 100

    def test_unhealthy(self):
        assert pm25_to_aqi(55.4) == 150

    def test_very_unhealthy(self):
        assert pm25_to_aqi(150.4) == 200

    def test_hazardous(self):
        assert pm25_to_aqi(250.4) == 300

    def test_max(self):
        assert pm25_to_aqi(500.4) == 500

    def test_over_max(self):
        assert pm25_to_aqi(600) == 500

    def test_negative(self):
        assert pm25_to_aqi(-5) == 0


class TestStabilityClassification:
    def test_daytime_low_wind_clear(self):
        assert classify_stability(1.0, 12, cloud_cover=0.3) == "A"

    def test_daytime_low_wind_cloudy(self):
        assert classify_stability(1.0, 12, cloud_cover=0.7) == "B"

    def test_daytime_moderate_wind(self):
        assert classify_stability(3.0, 10, cloud_cover=0.3) == "B"

    def test_daytime_high_wind(self):
        assert classify_stability(7.0, 14, cloud_cover=0.6) == "D"

    def test_nighttime_calm(self):
        assert classify_stability(1.0, 2) == "F"

    def test_nighttime_moderate(self):
        assert classify_stability(2.5, 22) == "E"

    def test_nighttime_windy(self):
        assert classify_stability(5.0, 0) == "D"


class TestSigmaParameters:
    def test_sigma_y_positive(self):
        assert sigma_y(100, "D") > 0

    def test_sigma_z_positive(self):
        assert sigma_z(100, "D") > 0

    def test_sigma_increases_with_distance(self):
        assert sigma_y(200, "D") > sigma_y(100, "D")
        assert sigma_z(200, "D") > sigma_z(100, "D")

    def test_unstable_wider_dispersion(self):
        # Class A should have wider dispersion than class F
        assert sigma_y(100, "A") > sigma_y(100, "F")
        assert sigma_z(100, "A") > sigma_z(100, "F")


class TestHaversine:
    def test_zero_distance(self):
        assert _haversine_m(-8.65, 115.2, -8.65, 115.2) == 0.0

    def test_known_distance(self):
        # ~111km per degree latitude at equator
        d = _haversine_m(0.0, 0.0, 1.0, 0.0)
        assert 110_000 < d < 112_000

    def test_bali_short_distance(self):
        # Denpasar to Kuta ~ roughly 10km
        d = _haversine_m(-8.65, 115.22, -8.72, 115.17)
        assert 5_000 < d < 15_000


class TestLineSourceConcentration:
    def _make_simple_road(self) -> list[tuple[float, float]]:
        """Simple east-west road segment."""
        return [(115.20, -8.65), (115.21, -8.65)]

    def test_positive_contribution(self):
        conc = _line_source_concentration(
            emission_rate_g_per_m_s=1e-6,
            wind_speed=2.0,
            receptor_lat=-8.6505,
            receptor_lon=115.205,
            segment_coords=self._make_simple_road(),
            source_height=0.5,
            stability="D",
            wind_direction_deg=180,
        )
        assert conc >= 0

    def test_higher_emission_higher_concentration(self):
        coords = self._make_simple_road()
        conc_low = _line_source_concentration(1e-7, 2.0, -8.651, 115.205, coords, 0.5, "D", 180)
        conc_high = _line_source_concentration(1e-5, 2.0, -8.651, 115.205, coords, 0.5, "D", 180)
        assert conc_high > conc_low

    def test_far_receptor_lower_concentration(self):
        coords = self._make_simple_road()
        conc_near = _line_source_concentration(1e-6, 2.0, -8.651, 115.205, coords, 0.5, "D", 180)
        conc_far = _line_source_concentration(1e-6, 2.0, -8.68, 115.205, coords, 0.5, "D", 180)
        assert conc_near >= conc_far


class TestFleetEmission:
    def test_fleet_avg_positive(self):
        assert FLEET_AVG.pm25 > 0
        assert FLEET_AVG.nox > 0
        assert FLEET_AVG.co > 0

    def test_fleet_avg_reasonable(self):
        # Weighted average should be between min and max individual factors
        assert 0.01 < FLEET_AVG.pm25 < 1.5
        assert 0.1 < FLEET_AVG.nox < 12.0


class TestComputeDispersion:
    def _make_road(self) -> RoadSegment:
        return RoadSegment(
            osm_way_id=12345,
            coords=[(115.20, -8.65), (115.21, -8.65)],
            highway="primary",
            lanes=2,
            width=7.0,
            surface="asphalt",
            maxspeed=40,
            landuse_proxy="residential",
            canyon_ratio=0.5,
            traffic_base_estimate=1000,
            traffic_calibration_factor=1.0,
        )

    def test_basic_dispersion(self):
        result = compute_dispersion(
            lat=-8.651, lon=115.205,
            roads=[self._make_road()],
            wind_speed=2.0, wind_direction=180,
            temperature=28, humidity=70, hour=12,
            baseline_pm25=15.0, baseline_pm10=25.0,
            baseline_no2=10.0, baseline_co=200.0, baseline_o3=30.0,
            region="bali",
        )
        assert result.aqi >= 0
        assert result.pm25 >= 15.0  # at least baseline
        assert result.layer_source == 2  # Mode B
        assert result.confidence > 0
        assert result.region == "bali"

    def test_no_roads_degraded_confidence(self):
        result = compute_dispersion(
            lat=-8.65, lon=115.20,
            roads=[],
            wind_speed=2.0, wind_direction=180,
            temperature=28, humidity=70, hour=12,
            region="bali",
        )
        assert result.confidence < 0.55  # degraded

    def test_high_humidity_reduces_pm(self):
        road = self._make_road()
        result_dry = compute_dispersion(
            lat=-8.651, lon=115.205, roads=[road],
            wind_speed=2.0, wind_direction=180,
            temperature=28, humidity=60, hour=12,
        )
        result_wet = compute_dispersion(
            lat=-8.651, lon=115.205, roads=[road],
            wind_speed=2.0, wind_direction=180,
            temperature=28, humidity=90, hour=12,
        )
        assert result_wet.pm25 <= result_dry.pm25
