import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from graph import CI_NONE, FLAG_FOOT, FLAG_STEPS, Graph, cls_byte, largest_component, polyline_length_m, write_graph  # noqa: E402


def grid(k=4, step=0.001, lon0=115.2, lat0=-8.65):
    """k x k street grid; every edge gets a midpoint vertex so shapes are exercised."""
    lon, lat = [], []
    for r in range(k):
        for c in range(k):
            lon.append(lon0 + c * step); lat.append(lat0 + r * step)
    edges = []
    hw = ["residential", "footway", "steps", "primary"]
    for r in range(k):
        for c in range(k):
            u = r * k + c
            for v in ([u + 1] if c + 1 < k else []) + ([u + k] if r + 1 < k else []):
                a, b = np.array([lon[u], lat[u]]), np.array([lon[v], lat[v]])
                mid = (a + b) / 2 + np.array([0.00002, -0.00001])
                edges.append({"u": u, "v": v, "coords": np.array([a, mid, b]), "highway": hw[len(edges) % 4], "ci": (1 << 20) | len(edges)})
    return np.array(lon), np.array(lat), edges


def test_both_directions_share_length_class_road_and_shape():
    lon, lat, edges = grid()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "g.bin")
        write_graph(path, lon, lat, edges, {"geometry": "test", "region": "bali", "name": "t", "bbox": [115.0, -9.0, 115.5, -8.5]})
        g = Graph(path)
        assert g.n == len(lon) and g.m == 2 * len(edges)
        off = g.cols["off"]
        assert off[0] == 0 and off[-1] == g.m and (np.diff(off.astype(int)) >= 0).all()
        for u in range(g.n):
            ts = [int(g.cols["target"][e]) for e in g.out(u)]
            assert ts == sorted(ts)
            for e in g.out(u):
                v = int(g.cols["target"][e])
                back = [f for f in g.out(v) if int(g.cols["target"][f]) == u]
                assert len(back) == 1
                f = back[0]
                for col in ("len_dm", "cls", "ci"):
                    assert g.cols[col][e] == g.cols[col][f]
                ce, cf = g.edge_coords(e, u), g.edge_coords(f, v)
                np.testing.assert_allclose(ce, cf[::-1], atol=1e-6)
                assert len(ce) == 3
                np.testing.assert_allclose(ce[0], g.lonlat(u)); np.testing.assert_allclose(ce[-1], g.lonlat(v))
                assert abs(g.cols["len_dm"][e] / 10 - polyline_length_m(ce)) < 0.2


def test_long_edges_are_split_and_length_is_kept():
    lon = np.array([115.0, 115.15]); lat = np.array([-8.6, -8.6])  # about 16.5 km
    co = np.column_stack([np.linspace(115.0, 115.15, 31), np.full(31, -8.6)])
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "g.bin")
        write_graph(path, lon, lat, [{"u": 0, "v": 1, "coords": co, "highway": "trunk", "ci": CI_NONE}], {"name": "t"})
        g = Graph(path)
        assert g.n == 2 + 2 and g.m == 2 * 3  # ceil(16.5 / 6.5) = 3 pieces, 2 new nodes
        assert g.cols["len_dm"].max() <= 65000
        total = sum(int(g.cols["len_dm"][e]) for u in range(g.n) for e in g.out(u)) / 20
        assert abs(total - polyline_length_m(co)) < 1.0


def test_largest_component_and_class_flags():
    mask = largest_component(6, [(0, 1), (1, 2), (3, 4)])
    assert mask.tolist() == [True, True, True, False, False, False]
    assert cls_byte("steps") & FLAG_STEPS and cls_byte("steps") & FLAG_FOOT
    assert cls_byte("footway") & FLAG_FOOT and not cls_byte("footway") & FLAG_STEPS
    assert cls_byte("residential") < 32 and cls_byte("residential", crossing=True) >= 128
