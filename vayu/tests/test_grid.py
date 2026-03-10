"""
VAYU Engine — Grid Manager Tests
==================================
Validates H3 indexing, tile creation, and coordinate conversions.
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.grid_manager import (
    AQITile,
    lat_lon_to_h3,
    h3_to_center,
    get_h3_ring,
    DEFAULT_RESOLUTION,
)


class TestH3Indexing:
    def test_denpasar_index(self):
        """H3 index for Denpasar should be a valid hex string."""
        idx = lat_lon_to_h3(-8.65, 115.22)
        assert isinstance(idx, str)
        assert len(idx) > 0

    def test_different_locations_different_indices(self):
        idx_bali = lat_lon_to_h3(-8.65, 115.22)
        idx_jakarta = lat_lon_to_h3(-6.20, 106.85)
        assert idx_bali != idx_jakarta

    def test_nearby_same_cell(self):
        """Very close points should be in the same H3 cell at coarse resolution."""
        idx1 = lat_lon_to_h3(-8.6500, 115.2200, resolution=7)
        idx2 = lat_lon_to_h3(-8.6501, 115.2201, resolution=7)
        # At res 7 (~1.2km edge), 0.0001 degree ~ 11m → definitely same cell
        assert idx1 == idx2

    def test_resolution_affects_index(self):
        idx_9 = lat_lon_to_h3(-8.65, 115.22, resolution=9)
        idx_11 = lat_lon_to_h3(-8.65, 115.22, resolution=11)
        assert idx_9 != idx_11  # different cells at different resolutions


class TestH3Center:
    def test_roundtrip(self):
        """Center of H3 cell should be close to original point."""
        original_lat, original_lon = -8.65, 115.22
        idx = lat_lon_to_h3(original_lat, original_lon)
        center_lat, center_lon = h3_to_center(idx)
        assert abs(center_lat - original_lat) < 0.001  # ~110m
        assert abs(center_lon - original_lon) < 0.001


class TestH3Ring:
    def test_ring_size(self):
        """k-ring of 1 should return 7 cells (center + 6 neighbors)."""
        cells = get_h3_ring(-8.65, 115.22, radius_k=1)
        assert len(cells) == 7

    def test_ring_contains_center(self):
        center = lat_lon_to_h3(-8.65, 115.22)
        cells = get_h3_ring(-8.65, 115.22, radius_k=1)
        assert center in cells

    def test_larger_ring(self):
        cells_k1 = get_h3_ring(-8.65, 115.22, radius_k=1)
        cells_k2 = get_h3_ring(-8.65, 115.22, radius_k=2)
        assert len(cells_k2) > len(cells_k1)


class TestAQITile:
    def test_tile_creation(self):
        tile = AQITile(
            tile_id="8b1929a94d03fff",
            lat=-8.65, lon=115.22,
            aqi=42, pm25=10.5, pm10=18.0,
            no2=8.0, co=150.0, o3=30.0,
            confidence=0.55, layer_source=2,
            region="bali",
            valid_until="2025-01-01T00:00:00Z",
        )
        assert tile.aqi == 42
        assert tile.layer_source == 2
        assert tile.region == "bali"
