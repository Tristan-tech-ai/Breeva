"""Build the walking graph pack (BGR1) of one field region from the phase-1 osmnx extraction.

    python vayu/field/build_graph.py --graph-dir D:/breeva-ml-data/graph/canonical_v2/bali \
        --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin --name badung_denpasar \
        --out D:/breeva-ml-data/field/graphs/2026-11/badung_denpasar.bin

Source: canonical_v2/<region> (osmnx 2.1.0, network_type walk, simplified, intersections consolidated at 10 m; passed the
five phase-1 quality gates, see validation_report.md there). Steps: keep the nodes inside the pack bbox and the edges
between them; drop self-loops and keep the shortest of parallel edges; measure the largest connected component (the
pack keeps only that component, the report gives its share before pruning); link every edge to the road-pack road it runs
along: a road with the same OSM way id nearest to the edge midpoint, else the nearest road within 30 m, else none.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import shapely

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from graph import CI_NONE, Graph, largest_component, write_graph  # noqa: E402
from pack import Pack  # noqa: E402

LINK_M = 30.0


def parse_osmid(s) -> list[int]:
    s = str(s).strip()
    if s.startswith("["):
        return [int(x) for x in json.loads(s.replace("'", '"'))]
    return [int(float(s))]


def first_highway(h) -> str:
    h = str(h)
    if h.startswith("["):
        return json.loads(h.replace("'", '"'))[0]
    return h


def link_roads(edge_lines: list[np.ndarray], edge_ways: list[list[int]], p: Pack) -> tuple[np.ndarray, dict]:
    """ci of the road each edge runs along. Distances in a local metric plane (equirectangular at the bbox centre)."""
    lat0 = np.radians((p.meta["bbox"][1] + p.meta["bbox"][3]) / 2)
    kx, ky = 111320.0 * np.cos(lat0), 110574.0

    def proj(co):
        co = np.asarray(co, dtype=float)
        return np.column_stack([co[:, 0] * kx, co[:, 1] * ky])

    roads = [shapely.linestrings(proj(p.coords(k))) for k in range(p.n)]
    tree = shapely.STRtree(roads)
    by_way: dict[int, list[int]] = {}
    for k in range(p.n):
        by_way.setdefault(int(p.cols["osm_way_id"][k]), []).append(k)
    ci_of = (p.cols["c"].astype(np.uint64) << np.uint64(20)) | p.cols["i"].astype(np.uint64)
    out = np.full(len(edge_lines), CI_NONE, dtype=np.uint64)
    how = {"same_way": 0, "nearest_30m": 0, "none": 0}
    for q, (co, ways) in enumerate(zip(edge_lines, edge_ways)):
        line = shapely.linestrings(proj(co))
        mid = shapely.line_interpolate_point(line, 0.5, normalized=True)
        cand = [k for w in ways for k in by_way.get(w, [])]
        if cand:
            k = min(cand, key=lambda r: shapely.distance(roads[r], mid))
            out[q] = ci_of[k]; how["same_way"] += 1
            continue
        k = tree.query_nearest(mid, max_distance=LINK_M)
        if len(k):
            out[q] = ci_of[int(k[0])]; how["nearest_30m"] += 1
        else:
            how["none"] += 1
    return out, how


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph-dir", required=True)
    ap.add_argument("--pack", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    t0 = time.time()
    p = Pack(a.pack)
    w, s, e, n = p.meta["bbox"]
    nodes = pd.read_parquet(os.path.join(a.graph_dir, "nodes.parquet"), columns=["node_id", "x", "y"])
    edges = pd.read_parquet(os.path.join(a.graph_dir, "edges.parquet"), columns=["u", "v", "osmid", "length", "highway", "geometry_wkt"])
    inside = nodes[(nodes.x >= w) & (nodes.x <= e) & (nodes.y >= s) & (nodes.y <= n)]
    keep = set(inside.node_id.astype(int))
    ed = edges[edges.u.isin(keep) & edges.v.isin(keep) & (edges.u != edges.v)].copy()
    ed["a"] = np.minimum(ed.u, ed.v); ed["b"] = np.maximum(ed.u, ed.v)
    ed = ed.sort_values(["a", "b", "length"]).drop_duplicates(["a", "b"])  # one undirected edge per node pair, the shortest
    ids = sorted(keep)
    idx = {nid: q for q, nid in enumerate(ids)}
    pos = inside.set_index("node_id").loc[ids]
    pairs = [(idx[int(u)], idx[int(v)]) for u, v in zip(ed.a, ed.b)]
    # Share of the largest component among nodes that have at least one edge (bbox clipping leaves some bare nodes).
    touched = np.zeros(len(ids), bool)
    for u, v in pairs:
        touched[u] = touched[v] = True
    lcc = largest_component(len(ids), pairs)
    share = float((lcc & touched).sum() / touched.sum())

    ed = ed[[bool(lcc[idx[int(u)]]) for u in ed.a]]
    sub = sorted(int(x) for x in np.array(ids)[lcc])
    sidx = {nid: q for q, nid in enumerate(sub)}
    lines, ways, rows = [], [], []
    for r in ed.itertuples():
        co = np.array(shapely.get_coordinates(shapely.from_wkt(r.geometry_wkt)))
        ux, uy = pos.loc[int(r.a), "x"], pos.loc[int(r.a), "y"]
        # orient the geometry from a to b
        if np.hypot(co[0, 0] - ux, co[0, 1] - uy) > np.hypot(co[-1, 0] - ux, co[-1, 1] - uy):
            co = co[::-1]
        co[0] = (ux, uy)
        co[-1] = (pos.loc[int(r.b), "x"], pos.loc[int(r.b), "y"])
        lines.append(co); ways.append(parse_osmid(r.osmid))
        rows.append({"u": sidx[int(r.a)], "v": sidx[int(r.b)], "coords": co, "highway": first_highway(r.highway)})
    ci, how = link_roads(lines, ways, p)
    for row, c in zip(rows, ci):
        row["ci"] = int(c)
    t1 = time.time()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    meta = {
        "geometry": p.meta["geometry"], "region": p.meta["region"], "name": a.name, "bbox": p.meta["bbox"],
        "source": "osmnx 2.1.0 walk graph, canonical_v2 (phase 1), clipped to the road-pack bbox",
        "stats": {"largest_component_share": round(share, 4), "nodes_with_edges_before_pruning": int(touched.sum()),
                  "nodes_dropped_outside_lcc": int((touched & ~lcc).sum()), "link": how},
    }
    tmp = a.out + ".tmp"
    head = write_graph(tmp, pos.loc[sub, "x"].values, pos.loc[sub, "y"].values, rows, meta)
    os.replace(tmp, a.out)
    g = Graph(a.out)
    deg = np.diff(g.cols["off"].astype(np.int64))
    linked = int((g.cols["ci"] != CI_NONE).sum())
    rep = {
        "out": a.out, "bytes": os.path.getsize(a.out), "n": g.n, "m": g.m, "shapes": head["shapes"],
        "largest_component_share_before_pruning": round(share, 4), "leaf_ratio": round(float((deg == 1).mean()), 4),
        "mean_out_degree": round(float(deg.mean()), 3), "edges_linked_pct": round(100 * linked / g.m, 2), "link": how,
        "split_nodes": g.n - len(sub), "max_len_m": round(float(g.cols["len_dm"].max()) / 10, 1),
        "seconds": {"build": round(t1 - t0, 1), "total": round(time.time() - t0, 1)},
    }
    with open(a.out[: -len(".bin")] + ".json", "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    print(json.dumps(rep))
    return rep


if __name__ == "__main__":
    main()
