import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "field"))
sys.path.insert(0, HERE)
from build_tiles import build, keep_at, verify  # noqa: E402
from pack import write_pack  # noqa: E402
from test_field_pack import synthetic  # noqa: E402


def test_every_road_is_in_the_top_zoom_once_and_filters_hold():
    rows = synthetic(200, seed=5)
    with tempfile.TemporaryDirectory() as d:
        pk = os.path.join(d, "p.bin")
        out = os.path.join(d, "t.pmtiles")
        write_pack(pk, rows, "test", "bali", (115.0, -9.0, 115.5, -8.5))
        rep = build(pk, out)
        v = verify(out, pk)
        assert v["unique_per_zoom"][14] == len(rows)
        assert v["names_below_z13"] == 0
        assert v["minor_roads_at_z10_11"] == 0
        assert v["layers"] == ["roads"]
        assert (v["min_zoom"], v["max_zoom"]) == (10, 14)
        primaries = sum(1 for r in rows if r["highway"] == "primary")
        assert v["unique_per_zoom"][10] <= primaries
        assert rep["bytes"] > 0


def test_zoom_filter_rules():
    assert keep_at(10, "secondary") and not keep_at(11, "tertiary")
    assert keep_at(12, "tertiary") and not keep_at(12, "residential")
    assert keep_at(13, "residential") and keep_at(14, "service")


def test_a_road_shorter_than_a_tile_unit_still_reaches_the_top_zoom():
    import numpy as np
    rows = synthetic(20, seed=9)
    rows[0]["coords"] = np.array([[115.2, -8.65], [115.2000032, -8.6500042]])  # about 0.6 m
    with tempfile.TemporaryDirectory() as d:
        pk = os.path.join(d, "p.bin")
        out = os.path.join(d, "t.pmtiles")
        write_pack(pk, rows, "test", "bali", (115.0, -9.0, 115.5, -8.5))
        build(pk, out)
        assert verify(out, pk)["unique_per_zoom"][14] == len(rows)
