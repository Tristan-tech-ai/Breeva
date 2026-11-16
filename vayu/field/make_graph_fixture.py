"""Writes tests/fixtures/graph_small.bin and graph_small.json so the TypeScript reader (src/lib/route/walkGraph.ts) is
tested against the Python writer (graph.py)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tests"))
from graph import Graph, write_graph  # noqa: E402
from test_field_graph import grid  # noqa: E402

out = os.path.join(HERE, "..", "..", "tests", "fixtures")
path = os.path.join(out, "graph_small.bin")
lon, lat, edges = grid(3)
write_graph(path, lon, lat, edges, {"geometry": "test", "region": "bali", "name": "small", "bbox": [115.0, -9.0, 115.5, -8.5]})
g = Graph(path)
want = {"n": g.n, "m": g.m, "nodes": [list(g.lonlat(u)) for u in range(g.n)], "edges": []}
for u in range(g.n):
    for e in g.out(u):
        want["edges"].append({"e": e, "u": u, "v": int(g.cols["target"][e]), "len_dm": int(g.cols["len_dm"][e]),
                              "cls": int(g.cols["cls"][e]), "ci": int(g.cols["ci"][e]), "coords": g.edge_coords(e, u).tolist()})
json.dump(want, open(os.path.join(out, "graph_small.json"), "w", encoding="utf-8"))
print("fixture", g.n, g.m, os.path.getsize(path))
