"""Build a road pack from the local road_segments backup.

    python vayu/field/build_pack.py --region bali --name badung_denpasar --bbox 115.08,-8.82,115.30,-8.56 --geometry 2026-11

Selection = rows of the backup region whose geometry bounds overlap the bbox (the rule of the proposal figure, which counted
60,961 roads for Badung-Denpasar). Output: D:/breeva-ml-data/field/packs/<geometry>/<name>.bin and a .json report.
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
from pack import Pack, write_pack  # noqa: E402

BACKUP = "D:/breeva-ml-data/backup_2026-11-14/road_segments.csv.gz"
OUT = "D:/breeva-ml-data/field/packs"
USECOLS = ["id", "osm_way_id", "geom", "highway", "lanes", "width", "surface", "name", "landuse_proxy", "canyon_ratio",
           "elevation_avg", "traffic_base_estimate", "traffic_calibration_factor", "region", "micro_class",
           "ai_pollution_factor"]


def fnum(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)


def load_rows(region: str, bbox: tuple[float, float, float, float]) -> tuple[list[dict], int]:
    rows = []
    skipped = 0
    for ch in pd.read_csv(BACKUP, usecols=USECOLS, chunksize=200_000, dtype={"name": str, "surface": str, "landuse_proxy": str,
                                                                              "micro_class": str, "highway": str}):
        ch = ch[ch.region == region]
        if not len(ch):
            continue
        gs = shapely.from_wkb(ch.geom.values)
        bd = shapely.bounds(gs)
        keep = ~((bd[:, 2] < bbox[0]) | (bd[:, 0] > bbox[2]) | (bd[:, 3] < bbox[1]) | (bd[:, 1] > bbox[3]))
        sub = ch[keep]
        for g, rec in zip(gs[keep], sub.to_dict("records")):
            co = shapely.get_coordinates(g)
            if len(co) < 2:
                skipped += 1
                continue
            rows.append({
                "row_id": int(rec["id"]), "osm_way_id": int(rec["osm_way_id"]), "highway": rec["highway"], "coords": co,
                **{k: fnum(rec[k]) for k in ("lanes", "width", "canyon_ratio", "traffic_base_estimate",
                                             "traffic_calibration_factor", "elevation_avg", "ai_pollution_factor")},
                **{k: (None if pd.isna(rec[k]) else str(rec[k])) for k in ("landuse_proxy", "surface", "micro_class", "name")},
            })
    return rows, skipped


def verify(p: Pack, rows: list[dict]) -> int:
    """Read every road back and compare it with the source row; returns the number of mismatching roads."""
    by_id = {r["row_id"]: r for r in rows}
    bad = 0
    for k in range(p.n):
        r = by_id.get(int(p.cols["row_id"][k]))
        ok = r is not None and int(p.cols["osm_way_id"][k]) == r["osm_way_id"]
        ok = ok and np.allclose(p.coords(k), r["coords"], atol=0.51 / p.meta["coord_scale"], rtol=0)
        for name in ("lanes", "width", "canyon_ratio", "traffic_base_estimate", "traffic_calibration_factor",
                     "elevation_avg", "ai_pollution_factor"):
            v = float(p.cols[name][k])
            ok = ok and ((np.isnan(v) and r[name] is None) or (r[name] is not None and np.isclose(v, r[name], rtol=1e-6)))
        for name in ("landuse_proxy", "surface", "micro_class", "name"):
            ok = ok and p.string(name, k) == (r[name] or "")
        bad += 0 if ok else 1
    return bad + abs(len(rows) - p.n)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--bbox", required=True, help="west,south,east,north")
    ap.add_argument("--geometry", default="2026-11")
    a = ap.parse_args(argv)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    t0 = time.time()
    rows, skipped = load_rows(a.region, bbox)
    t1 = time.time()
    os.makedirs(os.path.join(OUT, a.geometry), exist_ok=True)
    path = os.path.join(OUT, a.geometry, a.name + ".bin")
    meta = write_pack(path, rows, a.geometry, a.region, bbox)
    t2 = time.time()
    p = Pack(path)
    mismatches = verify(p, rows)
    nb = np.diff(p.cols["nb_off"].astype(np.int64))
    report = {
        "pack": path, "geometry": a.geometry, "region": a.region, "name": a.name, "bbox": bbox, "roads": p.n,
        "skipped_short": skipped, "cells": len(meta["cells"]), "bytes": os.path.getsize(path),
        "neighbours": {"mean": float(nb.mean()), "max": int(nb.max()), "min": int(nb.min())},
        "unique_osm_way_id": int(len(np.unique(p.cols["osm_way_id"]))),
        "read_back_mismatches": mismatches,
        "seconds": {"read_backup": round(t1 - t0, 1), "write_pack": round(t2 - t1, 1)},
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    with open(path[:-4] + ".json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
