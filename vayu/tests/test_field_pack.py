import math
import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from pack import COORD_SCALE, Pack, hilbert_d, neighbours, write_pack  # noqa: E402


def synthetic(n=300, seed=7):
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(n):
        lon0, lat0 = 115.15 + rng.random() * 0.1, -8.75 + rng.random() * 0.1
        m = int(rng.integers(2, 7))
        co = np.column_stack([lon0 + np.cumsum(rng.normal(0, 0.0005, m)), lat0 + np.cumsum(rng.normal(0, 0.0005, m))])
        rows.append({
            "row_id": 1000 + k, "osm_way_id": 5_000_000_000 + k, "highway": ["primary", "residential", "service", "weird"][k % 4],
            "coords": co, "lanes": None if k % 3 else 2.0, "width": 4.0 + k % 5, "canyon_ratio": 1.25,
            "traffic_base_estimate": 100.0 + k, "traffic_calibration_factor": 1.0, "elevation_avg": None,
            "ai_pollution_factor": 0.9 if k % 2 else None, "landuse_proxy": None, "surface": "asphalt" if k % 2 else None,
            "micro_class": None, "name": f"Jalan {k % 17}" if k % 4 else None,
        })
    return rows


def brute_neighbours(mid_lon, mid_lat):
    """Straight transcription of buildMultiSourceDeltas' candidate search (api/vayu/road-aqi.ts)."""
    cell = 0.0025
    out = []
    for r in range(len(mid_lat)):
        ci, cj = math.floor(mid_lat[r] / cell), math.floor(mid_lon[r] / cell)
        cand = []
        for s in range(len(mid_lat)):
            if abs(math.floor(mid_lat[s] / cell) - ci) <= 1 and abs(math.floor(mid_lon[s] / cell) - cj) <= 1:
                mlon = 111320 * math.cos(mid_lat[r] * math.pi / 180)
                dd = math.hypot((mid_lon[s] - mid_lon[r]) * mlon, (mid_lat[s] - mid_lat[r]) * 110574)
                if dd <= 500:
                    cand.append((dd, s))
        cand.sort(key=lambda t: t[0])
        out.append([s for _, s in cand[:40]])
    return out


def test_round_trip_is_identical():
    rows = synthetic()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.bin")
        write_pack(path, rows, "test", "bali", (115.0, -9.0, 115.5, -8.5))
        p = Pack(path)
        assert p.n == len(rows)
        by_id = {r["row_id"]: r for r in rows}
        for k in range(p.n):
            r = by_id[int(p.cols["row_id"][k])]
            assert int(p.cols["osm_way_id"][k]) == r["osm_way_id"]
            np.testing.assert_allclose(p.coords(k), r["coords"], atol=0.5 / COORD_SCALE)
            assert p.highway(k) == (r["highway"] if r["highway"] != "weird" else "other")
            for name in ("lanes", "width", "traffic_base_estimate", "ai_pollution_factor", "elevation_avg"):
                v = p.cols[name][k]
                assert (np.isnan(v) and r[name] is None) or math.isclose(v, r[name], rel_tol=1e-6)
            assert p.string("name", k) == (r["name"] or "")
            assert p.string("surface", k) == (r["surface"] or "")


def test_order_is_cell_then_consecutive_index():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.bin")
        write_pack(path, synthetic(), "test", "bali", (115.0, -9.0, 115.5, -8.5))
        p = Pack(path)
        c, i = p.cols["c"].astype(int), p.cols["i"].astype(int)
        assert (np.diff(c) >= 0).all()
        for cc in np.unique(c):
            assert list(i[c == cc]) == list(range(int((c == cc).sum())))
        assert len(set(zip(c, i))) == p.n


def test_neighbours_match_the_engine_candidate_search():
    rows = synthetic(250, seed=3)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "t.bin")
        write_pack(path, rows, "test", "bali", (115.0, -9.0, 115.5, -8.5))
        p = Pack(path)
        mids = np.array([p.coords(k)[len(p.coords(k)) // 2] for k in range(p.n)])
        want = brute_neighbours(mids[:, 0], mids[:, 1])
        got = [list(p.neighbours(k)) for k in range(p.n)]
        # same members (ties in distance may order differently)
        assert [sorted(g) for g in got] == [sorted(w) for w in want]
        assert all(k in got[k] for k in range(p.n))
        assert max(len(g) for g in got) <= 40


def test_hilbert_is_a_bijection_on_a_small_grid():
    order = 4
    ds = {hilbert_d(x, y, order) for x in range(16) for y in range(16)}
    assert ds == set(range(256))


def test_neighbour_cap_applies():
    lon = np.full(60, 115.2) + np.arange(60) * 1e-6
    lat = np.full(60, -8.65)
    nb = neighbours(lon, lat)
    assert all(len(x) == 40 for x in nb)


def test_pack_from_osm_extraction_parquet():
    import pandas as pd
    import shapely
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
    from build_pack import load_parquet
    df = pd.DataFrame({
        "osm_way_id": [11, 12, 13], "highway": ["primary", "residential", "service"], "name": ["Jalan Pajajaran", None, None],
        "lanes": [4.0, None, None], "surface": ["asphalt", None, None], "maxspeed": [None, None, None],
        "width": [12.0, 5.0, 4.0], "canyon_ratio": [1.3, 1.25, 1.25], "traffic_base_estimate": [1500.0, 100.0, 50.0],
        "traffic_calibration_factor": [1.0, 1.0, 1.0],
        "wkb": [shapely.to_wkb(shapely.linestrings([[106.79, -6.59], [106.80, -6.60]])),
                shapely.to_wkb(shapely.linestrings([[106.795, -6.595], [106.796, -6.596], [106.797, -6.597]])),
                shapely.to_wkb(shapely.Point(106.8, -6.6))],
    })
    with tempfile.TemporaryDirectory() as d:
        pq = os.path.join(d, "r.parquet")
        df.to_parquet(pq, index=False)
        rows, skipped = load_parquet(pq)
        assert skipped == 1 and len(rows) == 2
        path = os.path.join(d, "p.bin")
        write_pack(path, rows, "test", "bogor", (106.7, -6.7, 106.9, -6.5))
        p = Pack(path)
        names = {p.string("name", k) for k in range(p.n)}
        assert "Jalan Pajajaran" in names
        k = [k for k in range(p.n) if p.string("name", k) == "Jalan Pajajaran"][0]
        assert p.highway(k) == "primary" and float(p.cols["traffic_base_estimate"][k]) == 1500.0
