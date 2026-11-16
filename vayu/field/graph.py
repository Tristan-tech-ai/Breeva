"""Walking graph pack (BGR1, LAMPIRAN_TEKNIS L5.1) for the on-device router.

Layout (little endian), the same container as the road pack (pack.py):
    0   4   magic b"BGR1"
    4   4   uint32 header length H
    8   H   UTF-8 JSON header: geometry, region, name, bbox, n, m, coord_scale, cls_codes, flags, ci_none, stats, columns
    ... column blocks, each starting on an 8-byte boundary (offsets are absolute)

Columns:
    lat, lon   int32[n]     node position, degrees * 1e6
    off        uint32[n+1]  CSR: the directed edges leaving node u are off[u] .. off[u+1]-1, sorted by target
    target     uint32[m]    head node of each directed edge
    len_dm     uint16[m]    length in decimetres; edges longer than 6.5 km are split at interpolated nodes
    cls        uint8[m]     bits 0-4 highway code (index into cls_codes), bit 5 steps, bit 6 footway or path, bit 7 crossing
    ci         uint32[m]    (c << 20) | i of the road-pack road the edge runs along (ci_none when no road is near)
    sh         uint32[m]    (shape << 1) | reversed: shape of the edge between its end nodes, shared by both directions
    sh_off     uint32[s+1]  interior points of shape k are sh_pts[2*sh_off[k] .. 2*sh_off[k+1]-1] (lon, lat pairs, 1e-6),
    sh_pts     int32[2p]    listed from the lower node index to the higher one

Nodes are ordered along an order-16 Hilbert curve of their position, so nearby nodes sit together in memory.
"""
from __future__ import annotations

import json
import math
import struct

import numpy as np

from pack import HIGHWAY_CODES, hilbert_d, hw_code  # noqa: F401  (hw_code re-exported for build_graph)

MAGIC = b"BGR1"
COORD_SCALE = 1e6
MAX_EDGE_M = 6500.0
CI_NONE = 0xFFFFFFFF
FLAG_STEPS, FLAG_FOOT, FLAG_CROSSING = 32, 64, 128
FOOT_CLASSES = {"footway", "path", "pedestrian", "steps", "cycleway"}

COLUMNS = [
    ("lat", "<i4"), ("lon", "<i4"), ("off", "<u4"), ("target", "<u4"), ("len_dm", "<u2"), ("cls", "<u1"),
    ("ci", "<u4"), ("sh", "<u4"), ("sh_off", "<u4"), ("sh_pts", "<i4"),
]


def cls_byte(highway: str, crossing: bool = False) -> int:
    code = hw_code(highway)
    assert code < 32
    b = code
    if highway == "steps":
        b |= FLAG_STEPS
    if highway in FOOT_CLASSES:
        b |= FLAG_FOOT
    if crossing:
        b |= FLAG_CROSSING
    return b


def haversine_m(lon1, lat1, lon2, lat2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def polyline_length_m(coords: np.ndarray) -> float:
    if len(coords) < 2:
        return 0.0
    return float(haversine_m(coords[:-1, 0], coords[:-1, 1], coords[1:, 0], coords[1:, 1]).sum())


def split_polyline(coords: np.ndarray, parts: int) -> list[np.ndarray]:
    """Cut a polyline into `parts` pieces of equal length; consecutive pieces share their cut point."""
    seg = haversine_m(coords[:-1, 0], coords[:-1, 1], coords[1:, 0], coords[1:, 1])
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    cuts = [total * k / parts for k in range(parts + 1)]

    def at(d):
        j = min(int(np.searchsorted(cum, d, side="right")) - 1, len(seg) - 1)
        j = max(j, 0)
        f = 0.0 if seg[j] == 0 else (d - cum[j]) / seg[j]
        return coords[j] + f * (coords[j + 1] - coords[j])

    out = []
    for k in range(parts):
        a, b = cuts[k], cuts[k + 1]
        inner = [coords[q] for q in range(1, len(coords) - 1) if a < cum[q] < b]
        out.append(np.array([at(a), *inner, at(b)]))
    return out


def largest_component(n: int, edges: list[tuple[int, int]]) -> np.ndarray:
    """Boolean mask of the nodes in the largest connected component (undirected)."""
    parent = np.arange(n)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, v in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
    roots = np.array([find(x) for x in range(n)])
    vals, counts = np.unique(roots, return_counts=True)
    return roots == vals[np.argmax(counts)]


def write_graph(path: str, lon: np.ndarray, lat: np.ndarray, edges: list[dict], meta: dict) -> dict:
    """edges: undirected, each {u, v, coords (lon, lat array from u to v, end points included), highway, crossing, ci}.
    Writes both directions of every edge. Long edges are split here. Returns the header written."""
    lon = list(map(float, lon)); lat = list(map(float, lat))
    und = []  # (a, b, interior coords from a to b, length m, cls, ci) with a < b after splitting
    for e in edges:
        co = np.asarray(e["coords"], dtype=float)
        length = polyline_length_m(co)
        pieces = [co] if length <= MAX_EDGE_M else split_polyline(co, int(math.ceil(length / MAX_EDGE_M)))
        ends = [e["u"]]
        for p in pieces[:-1]:
            lon.append(float(p[-1, 0])); lat.append(float(p[-1, 1]))
            ends.append(len(lon) - 1)
        ends.append(e["v"])
        cb = cls_byte(e["highway"], bool(e.get("crossing")))
        for k, p in enumerate(pieces):
            a, b = ends[k], ends[k + 1]
            if a > b:
                a, b, p = b, a, p[::-1]
            und.append((a, b, p[1:-1], polyline_length_m(p), cb, int(e.get("ci", CI_NONE))))
    n = len(lon)
    lon_a, lat_a = np.array(lon), np.array(lat)

    # Hilbert order of nodes.
    x0, x1, y0, y1 = lon_a.min(), lon_a.max(), lat_a.min(), lat_a.max()
    side = (1 << 16) - 1
    hx = np.round((lon_a - x0) / max(x1 - x0, 1e-12) * side).astype(int)
    hy = np.round((lat_a - y0) / max(y1 - y0, 1e-12) * side).astype(int)
    order = sorted(range(n), key=lambda q: (hilbert_d(int(hx[q]), int(hy[q]), 16), q))
    new = np.empty(n, dtype=np.int64); new[order] = np.arange(n)

    shapes, directed = [], []
    for a, b, inner, length, cb, ci in und:
        na, nb = int(new[a]), int(new[b])
        if na > nb:
            na, nb, inner = nb, na, inner[::-1]
        s = len(shapes)
        shapes.append(inner)
        dm = int(round(length * 10))
        assert dm <= 65535, length
        directed.append((na, nb, dm, cb, ci, (s << 1) | 0))
        directed.append((nb, na, dm, cb, ci, (s << 1) | 1))
    directed.sort(key=lambda t: (t[0], t[1], t[5]))
    m = len(directed)
    off = np.zeros(n + 1, dtype=np.uint32)
    for t in directed:
        off[t[0] + 1] += 1
    off = np.cumsum(off).astype(np.uint32)
    sh_off = np.zeros(len(shapes) + 1, dtype=np.uint32)
    for k, s in enumerate(shapes):
        sh_off[k + 1] = sh_off[k] + len(s)
    pts = np.concatenate([np.asarray(s, dtype=float).reshape(-1, 2) for s in shapes]) if sh_off[-1] else np.zeros((0, 2))
    cols = {
        "lat": np.round(lat_a[order] * COORD_SCALE).astype("<i4"), "lon": np.round(lon_a[order] * COORD_SCALE).astype("<i4"),
        "off": off, "target": np.array([t[1] for t in directed], dtype="<u4"),
        "len_dm": np.array([t[2] for t in directed], dtype="<u2"), "cls": np.array([t[3] for t in directed], dtype="<u1"),
        "ci": np.array([t[4] for t in directed], dtype="<u4"), "sh": np.array([t[5] for t in directed], dtype="<u4"),
        "sh_off": sh_off, "sh_pts": np.round(pts.reshape(-1) * COORD_SCALE).astype("<i4"),
    }
    header = dict(meta)
    header.update({
        "format": "BGR1", "n": n, "m": m, "shapes": len(shapes), "coord_scale": COORD_SCALE, "cls_codes": HIGHWAY_CODES,
        "flags": {"steps": FLAG_STEPS, "footway": FLAG_FOOT, "crossing": FLAG_CROSSING}, "ci_none": CI_NONE,
        "max_edge_m": MAX_EDGE_M,
    })

    def layout(head_len):
        pos = 8 + head_len
        out = []
        for name, dt in COLUMNS:
            pos = (pos + 7) // 8 * 8
            out.append({"name": name, "dtype": dt, "offset": pos, "count": int(len(cols[name]))})
            pos += cols[name].nbytes
        return out

    header["columns"] = layout(0)
    for _ in range(3):  # header length depends on the offsets it lists
        head = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        header["columns"] = layout(len(head))
    head = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert header["columns"] == layout(len(head))
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<I", len(head)) + head)
        for col in header["columns"]:
            pad = col["offset"] - f.tell()
            f.write(b"\0" * pad)
            f.write(np.ascontiguousarray(cols[col["name"]], dtype=col["dtype"]).tobytes())
    return header


class Graph:
    """Reader, used by the tests and the build report."""

    def __init__(self, path: str):
        raw = open(path, "rb").read()
        assert raw[:4] == MAGIC, "not a BGR1 graph"
        hl = struct.unpack("<I", raw[4:8])[0]
        self.meta = json.loads(raw[8:8 + hl].decode("utf-8"))
        self.cols = {c["name"]: np.frombuffer(raw, dtype=c["dtype"], count=c["count"], offset=c["offset"]) for c in self.meta["columns"]}
        self.n, self.m = self.meta["n"], self.meta["m"]

    def lonlat(self, u: int) -> tuple[float, float]:
        return self.cols["lon"][u] / COORD_SCALE, self.cols["lat"][u] / COORD_SCALE

    def out(self, u: int) -> range:
        return range(int(self.cols["off"][u]), int(self.cols["off"][u + 1]))

    def edge_coords(self, e: int, u: int) -> np.ndarray:
        """Full polyline of directed edge e leaving node u (end points included)."""
        s = int(self.cols["sh"][e])
        k, rev = s >> 1, s & 1
        a, b = int(self.cols["sh_off"][k]), int(self.cols["sh_off"][k + 1])
        inner = self.cols["sh_pts"][2 * a:2 * b].reshape(-1, 2) / COORD_SCALE
        if rev:
            inner = inner[::-1]
        v = int(self.cols["target"][e])
        return np.vstack([self.lonlat(u), inner, self.lonlat(v)]) if len(inner) else np.array([self.lonlat(u), self.lonlat(v)])
