"""Validate a field run: manifest, every BVF1 cell, cell sizes against the road pack, value ranges.

    python vayu/field/validate_field.py --root D:/breeva-ml-data/field --name badung_denpasar \
        --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin
Exit code 0 only when every check passes; prints a JSON summary.
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pack import Pack  # noqa: E402

STEP = {"pm25": 0.1, "pm25_delta": 0.05, "no2": 1.0, "no2_delta": 0.25, "pi_half": 2.0}


def decode_cell(buf: bytes) -> dict[str, np.ndarray]:
    if buf[:4] != b"BVF1":
        raise ValueError("bad magic")
    n, mask = struct.unpack_from("<IH", buf, 4)
    if mask != 0b11111:
        raise ValueError(f"unsupported column mask {mask}")
    if len(buf) != 12 + 6 * n:
        raise ValueError(f"size {len(buf)} != 12 + 6*{n}")
    o = 12
    pm = np.frombuffer(buf, "<u2", n, o) * STEP["pm25"]; o += 2 * n
    pd_ = np.frombuffer(buf, "u1", n, o) * STEP["pm25_delta"]; o += n
    no = np.frombuffer(buf, "u1", n, o) * STEP["no2"]; o += n
    nd = np.frombuffer(buf, "u1", n, o) * STEP["no2_delta"]; o += n
    fl = np.frombuffer(buf, "u1", n, o)
    return {"pm25": pm, "pm25_delta": pd_, "no2": no, "no2_delta": nd, "confidence": fl & 3, "ood": (fl & 4) != 0,
            "pi_half": (fl >> 3) * STEP["pi_half"]}


def validate(root: str, name: str, pack_path: str) -> dict:
    problems = []
    man_path = os.path.join(root, "v", name, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    p = Pack(pack_path)
    if man.get("geometry") != p.meta["geometry"]:
        problems.append(f"geometry {man.get('geometry')} != pack {p.meta['geometry']}")
    counts = np.bincount(p.cols["c"].astype(np.int64), minlength=len(p.meta["cells"]))
    run_dir = os.path.join(root, "v", name, man["run"])
    total = 0
    stats = {"pm25_min": None, "pm25_max": None}
    for c in man["cells"]:
        path = os.path.join(run_dir, f"{c}.bin")
        if not os.path.exists(path):
            problems.append(f"cell {c} missing")
            continue
        try:
            d = decode_cell(open(path, "rb").read())
        except ValueError as e:
            problems.append(f"cell {c}: {e}")
            continue
        n = len(d["pm25"])
        total += n
        if n != counts[c]:
            problems.append(f"cell {c}: {n} values, pack has {counts[c]} roads")
        if not np.all(d["pm25"] >= d["pm25_delta"] - STEP["pm25"]):
            problems.append(f"cell {c}: traffic delta larger than total pm25")
        if np.any(d["pm25"] > 1000):
            problems.append(f"cell {c}: pm25 above 1000")
        lo, hi = float(d["pm25"].min()), float(d["pm25"].max())
        stats["pm25_min"] = lo if stats["pm25_min"] is None else min(stats["pm25_min"], lo)
        stats["pm25_max"] = hi if stats["pm25_max"] is None else max(stats["pm25_max"], hi)
    if total != p.n:
        problems.append(f"{total} values in run, pack has {p.n} roads")
    return {"run": man["run"], "cells": len(man["cells"]), "values": total, "problems": problems, **stats}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--pack", required=True)
    a = ap.parse_args(argv)
    r = validate(a.root, a.name, a.pack)
    print(json.dumps(r))
    sys.exit(0 if not r["problems"] else 1)


if __name__ == "__main__":
    main()
