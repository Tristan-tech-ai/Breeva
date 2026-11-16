"""Walking graph pack (BGR1) built straight from a road pack, for regions without the phase-1 osmnx extraction.

    python vayu/field/graph_from_pack.py --pack D:/breeva-ml-data/field/packs/2026-11/kota_bogor.bin \
        --out D:/breeva-ml-data/field/graphs/2026-11/kota_bogor.bin

OSM ways that meet share a node, and a node keeps its exact coordinates in every way, so after the pack's 1e-7 degree
quantisation a shared vertex is the same pair of integers in both ways. Nodes of the graph = way end points plus every
vertex that occurs more than once; each way is cut at its nodes into edges that keep the way's geometry and its road
(c, i). Ways that cross without a shared node (bridges, flyovers) stay unconnected, as in OSM. Motorways (toll roads)
are left out of a walking graph. The pack keeps only the largest connected component; the report gives its share.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from graph import CI_NONE, Graph, largest_component, polyline_length_m, write_graph  # noqa: E402
from pack import Pack  # noqa: E402

NOT_WALKABLE = {"motorway", "motorway_link"}


def edges_from_ways(ways: list[dict]) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """ways: {ints: int array (m, 2) of quantised lon/lat, coords: float (m, 2), highway, ci}. Returns node lon, lat and
    undirected edges {u, v, coords, highway, ci} (shortest kept for a repeated node pair, self-loops dropped)."""
    count = Counter()
    for w in ways:
        for x, y in map(tuple, w["ints"]):
            count[(x, y)] += 1
    node_id: dict[tuple[int, int], int] = {}
    lon, lat = [], []

    def node(key, xy):
        if key not in node_id:
            node_id[key] = len(lon)
            lon.append(float(xy[0])); lat.append(float(xy[1]))
        return node_id[key]

    best: dict[tuple[int, int], dict] = {}
    for w in ways:
        ints, co = w["ints"], w["coords"]
        cut = [0] + [q for q in range(1, len(ints) - 1) if count[tuple(ints[q])] > 1] + [len(ints) - 1]
        for a, b in zip(cut[:-1], cut[1:]):
            u = node(tuple(ints[a]), co[a]); v = node(tuple(ints[b]), co[b])
            if u == v:
                continue
            seg = co[a:b + 1]
            e = {"u": u, "v": v, "coords": seg, "highway": w["highway"], "ci": w["ci"], "len": polyline_length_m(seg)}
            k = (min(u, v), max(u, v))
            if k not in best or e["len"] < best[k]["len"]:
                best[k] = e
    return np.array(lon), np.array(lat), list(best.values())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    t0 = time.time()
    p = Pack(a.pack)
    scale = p.meta["coord_scale"]
    raw = p.cols["coords"].reshape(-1, 2)
    off = p.cols["coord_off"]
    ways, skipped = [], 0
    for k in range(p.n):
        hw = p.highway(k)
        if hw in NOT_WALKABLE:
            skipped += 1
            continue
        ints = raw[int(off[k]):int(off[k + 1])].astype(np.int64)
        if len(ints) < 2:
            continue
        ways.append({"ints": ints, "coords": ints / scale, "highway": hw,
                     "ci": int((int(p.cols["c"][k]) << 20) | int(p.cols["i"][k]))})
    lon, lat, edges = edges_from_ways(ways)
    touched = np.zeros(len(lon), bool)
    for e in edges:
        touched[e["u"]] = touched[e["v"]] = True
    lcc = largest_component(len(lon), [(e["u"], e["v"]) for e in edges])
    share = float((lcc & touched).sum() / max(1, touched.sum()))
    keep = np.flatnonzero(lcc)
    new = {int(old): q for q, old in enumerate(keep)}
    kept = [dict(e, u=new[e["u"]], v=new[e["v"]]) for e in edges if lcc[e["u"]]]
    meta = {
        "geometry": p.meta["geometry"], "region": p.meta["region"], "name": os.path.basename(a.out)[: -len(".bin")],
        "bbox": p.meta["bbox"], "source": "road pack ways cut at shared OSM nodes (vayu/field/graph_from_pack.py)",
        "stats": {"largest_component_share": round(share, 4), "ways": len(ways), "motorway_ways_left_out": skipped},
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    write_graph(tmp, lon[keep], lat[keep], kept, meta)
    os.replace(tmp, a.out)
    g = Graph(a.out)
    deg = np.diff(g.cols["off"].astype(np.int64))
    rep = {"out": a.out, "bytes": os.path.getsize(a.out), "n": g.n, "m": g.m,
           "largest_component_share_before_pruning": round(share, 4), "leaf_ratio": round(float((deg == 1).mean()), 4),
           "mean_out_degree": round(float(deg.mean()), 3), "edges_linked_pct": round(100 * float((g.cols["ci"] != CI_NONE).mean()), 2),
           "ways": len(ways), "motorway_ways_left_out": skipped, "seconds": round(time.time() - t0, 1)}
    with open(a.out[: -len(".bin")] + ".json", "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
