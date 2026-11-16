import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from graph_from_pack import edges_from_ways  # noqa: E402


def way(pts, hw="residential", ci=1):
    ints = np.array([[round(x * 1e7), round(y * 1e7)] for x, y in pts], dtype=np.int64)
    return {"ints": ints, "coords": ints / 1e7, "highway": hw, "ci": ci}


def test_ways_meeting_at_a_shared_vertex_are_cut_there():
    a = way([(106.80, -6.60), (106.801, -6.60), (106.802, -6.60)], ci=1)      # west-east
    b = way([(106.801, -6.601), (106.801, -6.60), (106.801, -6.599)], ci=2)   # south-north through a's middle vertex
    lon, lat, edges = edges_from_ways([a, b])
    assert len(lon) == 5                       # 4 end points + 1 junction
    assert len(edges) == 4
    junction = [k for k in range(len(lon)) if abs(lon[k] - 106.801) < 1e-9 and abs(lat[k] + 6.60) < 1e-9]
    assert len(junction) == 1
    assert sum(1 for e in edges if junction[0] in (e["u"], e["v"])) == 4
    assert {e["ci"] for e in edges} == {1, 2}


def test_a_bridge_without_a_shared_node_stays_unconnected_and_loops_are_dropped():
    a = way([(106.80, -6.60), (106.802, -6.60)], ci=1)
    bridge = way([(106.801, -6.601), (106.801, -6.599)], ci=2)                 # crosses a, no shared vertex
    ring = way([(106.81, -6.61), (106.811, -6.61), (106.81, -6.61)], ci=3)     # closed way with one node
    lon, lat, edges = edges_from_ways([a, bridge, ring])
    assert len(edges) == 2
    assert all(e["ci"] in (1, 2) for e in edges)


def test_parallel_ways_keep_the_shortest():
    short = way([(106.80, -6.60), (106.801, -6.60)], ci=1)
    long = way([(106.80, -6.60), (106.8005, -6.5995), (106.801, -6.60)], ci=2)
    _, _, edges = edges_from_ways([short, long])
    assert len(edges) == 1 and edges[0]["ci"] == 1
