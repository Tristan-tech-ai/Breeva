"""Reference shortest paths for the on-device router (task F3-02, gate G3).

    vayu/.venv/Scripts/python vayu/field/route_reference.py --graph D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.bin \
        --out D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.ref200.json [--pairs 200 --seed 20261116]

Reads the BGR1 pack with the Python reader, builds a networkx DiGraph with edge weight len_dm / 10 (metres), and writes
random node pairs (seeded) with their networkx shortest-path length, for scripts/field/router-bench.mts to compare.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import networkx as nx
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from graph import Graph  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pairs", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20261116)
    a = ap.parse_args(argv)
    g = Graph(a.graph)
    G = nx.DiGraph()
    off, tgt, dm = g.cols["off"], g.cols["target"], g.cols["len_dm"]
    for u in range(g.n):
        for e in range(int(off[u]), int(off[u + 1])):
            v = int(tgt[e])
            w = float(dm[e]) / 10.0
            if not G.has_edge(u, v) or G[u][v]["weight"] > w:
                G.add_edge(u, v, weight=w)
    rng = np.random.default_rng(a.seed)
    pairs = []
    t0 = time.time()
    while len(pairs) < a.pairs:
        s, t = (int(x) for x in rng.integers(0, g.n, 2))
        if s == t:
            continue
        d = nx.shortest_path_length(G, s, t, weight="weight")
        pairs.append({"s": s, "t": t, "length_m": round(float(d), 2)})
    out = {"graph": a.graph, "n": g.n, "m": g.m, "seed": a.seed, "networkx": nx.__version__, "pairs": pairs,
           "seconds": round(time.time() - t0, 1)}
    json.dump(out, open(a.out, "w"), indent=0)
    print(json.dumps({k: v for k, v in out.items() if k != "pairs"}), "median_m", float(np.median([p["length_m"] for p in pairs])))


if __name__ == "__main__":
    main()
