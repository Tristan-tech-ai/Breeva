"""Road pack (BRP1): static road attributes, polylines and neighbour lists for one region and geometry version.

Layout (little endian):
    0   4   magic b"BRP1"
    4   4   uint32 header length H
    8   H   UTF-8 JSON header: geometry, region, bbox, n, cells, strings, columns [{name, dtype, offset, count}]
    ... column blocks, each starting on an 8-byte boundary (offsets are absolute)

Road order is (c, i): c = index of the z12 tile holding the road midpoint in the sorted list header["cells"] (sorted by y,
then x); i = rank of the order-16 Hilbert index of the midpoint inside that tile (ties by row id). The midpoint is
coords[len // 2], the same receptor point the service engine uses (buildMultiSourceDeltas in api/vayu/road-aqi.ts).

Neighbour lists reproduce the engine's candidate set exactly: midpoints bucketed on a 0.0025 degree grid, candidates from
the 3x3 buckets around the receptor, kept when <= 500 m (dx = dlon*111320*cos(lat), dy = dlat*110574), sorted by
distance, at most 40, the road itself included.
"""
from __future__ import annotations

import json
import math
import struct

import numpy as np

MAGIC = b"BRP1"
COORD_SCALE = 1e7  # int32 degrees * 1e7 (about 1 cm)
CELL_ZOOM = 12
HILBERT_ORDER = 16
NB_CELL_DEG = 0.0025
NB_CUTOFF_M = 500.0
NB_CAP = 40

HIGHWAY_CODES = [
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road", "track",
    "pedestrian", "footway", "path", "cycleway", "steps", "other",
]

# name -> numpy dtype; float columns use NaN for SQL NULL; string columns are indexes into header["strings"][name]
COLUMNS = {
    "c": "<u2", "i": "<u4", "row_id": "<f8", "osm_way_id": "<f8", "hw": "<u1",
    "lanes": "<f4", "width": "<f4", "canyon_ratio": "<f4", "traffic_base_estimate": "<f4",
    "traffic_calibration_factor": "<f4", "elevation_avg": "<f4", "ai_pollution_factor": "<f4",
    "landuse_proxy": "<u4", "surface": "<u4", "micro_class": "<u4", "name": "<u4",
    "coord_off": "<u4", "coords": "<i4", "nb_off": "<u4", "nb": "<u4",
}
STRING_COLUMNS = ("landuse_proxy", "surface", "micro_class", "name")
FLOAT_COLUMNS = ("lanes", "width", "canyon_ratio", "traffic_base_estimate", "traffic_calibration_factor",
                 "elevation_avg", "ai_pollution_factor")


def hw_code(h: str | None) -> int:
    try:
        return HIGHWAY_CODES.index(h or "")
    except ValueError:
        return HIGHWAY_CODES.index("other")


def tile_xy(lon: float, lat: float, z: int = CELL_ZOOM) -> tuple[float, float]:
    """Fractional slippy-map tile coordinates."""
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * n
    return x, y


def hilbert_d(x: int, y: int, order: int = HILBERT_ORDER) -> int:
    """Index along the Hilbert curve of a 2^order grid (classic xy2d)."""
    n = 1 << order
    d = 0
    s = n >> 1
    while s > 0:
        rx = 1 if (x & s) else 0
        ry = 1 if (y & s) else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x = n - 1 - x
                y = n - 1 - y
            x, y = y, x
        s >>= 1
    return d


def midpoint(coords: np.ndarray) -> tuple[float, float]:
    m = coords[len(coords) // 2]
    return float(m[0]), float(m[1])


def order_roads(mids: list[tuple[float, float]], row_ids: list[int]) -> tuple[list[tuple[int, int]], np.ndarray, np.ndarray, np.ndarray]:
    """Returns (cells, order, c, i): cells sorted by (y, x); order = permutation of input rows into (c, i) order."""
    tiles, hil = [], []
    side = 1 << HILBERT_ORDER
    for lon, lat in mids:
        fx, fy = tile_xy(lon, lat)
        tx, ty = int(math.floor(fx)), int(math.floor(fy))
        hx = min(side - 1, int((fx - tx) * side))
        hy = min(side - 1, int((fy - ty) * side))
        tiles.append((tx, ty))
        hil.append(hilbert_d(hx, hy))
    cells = sorted(set(tiles), key=lambda t: (t[1], t[0]))
    cidx = {t: k for k, t in enumerate(cells)}
    keys = [(cidx[tiles[r]], hil[r], row_ids[r]) for r in range(len(mids))]
    order = np.array(sorted(range(len(mids)), key=lambda r: keys[r]), dtype=np.int64)
    c = np.array([keys[r][0] for r in order], dtype=np.uint16)
    i = np.zeros(len(order), dtype=np.uint32)
    for k in range(1, len(order)):
        i[k] = 0 if c[k] != c[k - 1] else i[k - 1] + 1
    return cells, order, c, i


def neighbours(mid_lon: np.ndarray, mid_lat: np.ndarray) -> list[np.ndarray]:
    """Engine-identical candidate lists (see module docstring). Indexes refer to the given order."""
    buckets: dict[tuple[int, int], list[int]] = {}
    bi = np.floor(mid_lat / NB_CELL_DEG).astype(np.int64)
    bj = np.floor(mid_lon / NB_CELL_DEG).astype(np.int64)
    for k in range(len(mid_lat)):
        buckets.setdefault((int(bi[k]), int(bj[k])), []).append(k)
    out = []
    for r in range(len(mid_lat)):
        cand = []
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                cand.extend(buckets.get((int(bi[r]) + di, int(bj[r]) + dj), ()))
        cand = np.array(cand, dtype=np.int64)
        mlon = 111320.0 * math.cos(mid_lat[r] * math.pi / 180.0)
        dx = (mid_lon[cand] - mid_lon[r]) * mlon
        dy = (mid_lat[cand] - mid_lat[r]) * 110574.0
        dd = np.hypot(dx, dy)
        keep = dd <= NB_CUTOFF_M
        cand, dd = cand[keep], dd[keep]
        o = np.argsort(dd, kind="stable")[:NB_CAP]
        out.append(cand[o].astype(np.uint32))
    return out


def _string_index(values: list[str | None]) -> tuple[list[str], np.ndarray]:
    table = [""]
    pos = {"": 0}
    idx = np.zeros(len(values), dtype=np.uint32)
    for k, v in enumerate(values):
        v = "" if v is None or (isinstance(v, float) and math.isnan(v)) else str(v)
        if v not in pos:
            pos[v] = len(table)
            table.append(v)
        idx[k] = pos[v]
    return table, idx


def write_pack(path: str, rows: list[dict], geometry: str, region: str, bbox: tuple[float, float, float, float]) -> dict:
    """rows: dicts with row_id, osm_way_id, highway, coords (N x 2 lon/lat array) and the attribute keys of COLUMNS."""
    mids = [midpoint(np.asarray(r["coords"])) for r in rows]
    cells, order, c, i = order_roads(mids, [int(r["row_id"]) for r in rows])
    rs = [rows[k] for k in order]
    mid_lon = np.array([mids[k][0] for k in order])
    mid_lat = np.array([mids[k][1] for k in order])
    nbs = neighbours(mid_lon, mid_lat)

    cols: dict[str, np.ndarray] = {"c": c, "i": i}
    cols["row_id"] = np.array([r["row_id"] for r in rs], dtype="<f8")
    cols["osm_way_id"] = np.array([r["osm_way_id"] for r in rs], dtype="<f8")
    cols["hw"] = np.array([hw_code(r.get("highway")) for r in rs], dtype="<u1")
    for name in FLOAT_COLUMNS:
        cols[name] = np.array([np.nan if r.get(name) is None else r[name] for r in rs], dtype="<f4")
    strings = {}
    for name in STRING_COLUMNS:
        strings[name], cols[name] = _string_index([r.get(name) for r in rs])
    lens = np.array([len(r["coords"]) for r in rs], dtype=np.int64)
    cols["coord_off"] = np.concatenate([[0], np.cumsum(lens)]).astype("<u4")
    allc = np.concatenate([np.asarray(r["coords"], dtype=np.float64) for r in rs]) if rs else np.zeros((0, 2))
    cols["coords"] = np.round(allc * COORD_SCALE).astype("<i4").reshape(-1)
    nl = np.array([len(x) for x in nbs], dtype=np.int64)
    cols["nb_off"] = np.concatenate([[0], np.cumsum(nl)]).astype("<u4")
    cols["nb"] = (np.concatenate(nbs) if nbs else np.zeros(0)).astype("<u4")

    meta = {"format": "BRP1", "geometry": geometry, "region": region, "bbox": list(bbox), "n": len(rs),
            "cells": [list(t) for t in cells], "cell_zoom": CELL_ZOOM, "hilbert_order": HILBERT_ORDER,
            "coord_scale": COORD_SCALE, "highway_codes": HIGHWAY_CODES, "strings": strings,
            "neighbours": {"cell_deg": NB_CELL_DEG, "cutoff_m": NB_CUTOFF_M, "cap": NB_CAP}, "columns": []}
    # two passes: header size depends on offsets, offsets depend on header size
    for _ in range(3):
        head = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        off = 8 + len(head)
        off += (-off) % 8
        new_cols = []
        for name in COLUMNS:
            arr = cols[name]
            new_cols.append({"name": name, "dtype": COLUMNS[name], "offset": off, "count": int(arr.size)})
            off += arr.nbytes
            off += (-off) % 8
        if new_cols == meta["columns"]:
            break
        meta["columns"] = new_cols
    head = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<I", len(head)) + head)
        for col in meta["columns"]:
            pad = col["offset"] - f.tell()
            assert pad >= 0
            f.write(b"\0" * pad)
            f.write(np.ascontiguousarray(cols[col["name"]], dtype=col["dtype"]).tobytes())
    return meta


class Pack:
    def __init__(self, path: str):
        with open(path, "rb") as f:
            buf = f.read()
        if buf[:4] != MAGIC:
            raise ValueError("not a BRP1 pack")
        (hl,) = struct.unpack_from("<I", buf, 4)
        self.meta = json.loads(buf[8:8 + hl].decode("utf-8"))
        self.cols = {}
        for col in self.meta["columns"]:
            dt = np.dtype(col["dtype"])
            self.cols[col["name"]] = np.frombuffer(buf, dtype=dt, count=col["count"], offset=col["offset"])
        self.n = self.meta["n"]

    def coords(self, k: int) -> np.ndarray:
        a, b = self.cols["coord_off"][k], self.cols["coord_off"][k + 1]
        return self.cols["coords"][2 * a:2 * b].reshape(-1, 2) / self.meta["coord_scale"]

    def neighbours(self, k: int) -> np.ndarray:
        a, b = self.cols["nb_off"][k], self.cols["nb_off"][k + 1]
        return self.cols["nb"][a:b]

    def string(self, name: str, k: int) -> str:
        return self.meta["strings"][name][int(self.cols[name][k])]

    def highway(self, k: int) -> str:
        return self.meta["highway_codes"][int(self.cols["hw"][k])]
