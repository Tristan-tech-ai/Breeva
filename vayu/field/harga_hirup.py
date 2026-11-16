"""Harga hirup H_e: how much breathing the emissions of one metre of road reach, per road of a field region.

    python vayu/field/harga_hirup.py --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin \
        --buildings D:/breeva-ml-data/field/osm/badung_denpasar_buildings.parquet \
        --facilities <osm facilities json> --out D:/breeva-ml-data/field/harga/2026-11/badung_denpasar.bin

Method (routing externality, roadmap decision 14 Nov; LAMPIRAN L5.2 term H_e):
  receptors  10 m raster of building footprint area (OSM, area to the centroid cell; a proxy of where people are), plus
             an equivalent area for each school and health facility (FACILITY_M2, so a kindergarten counts like a
             dense block of houses even when its building is small or missing in OSM);
  kernel     ISC sector-averaged ground-level plume of a unit ground-level source, 8 wind sectors of 45 degrees, wind
             1 m/s, Briggs urban class D dispersion (sigma_z = 0.14 x (1 + 0.0003 x)^-1/2) with an initial mixing
             sigma_z0 = 2.5 m, cut at 500 m:  C(r) = sqrt(2/pi) / (sigma_z(r) * r * dtheta) inside the downwind sector;
             the wind-averaged kernel is the mean of the 8 sectors, sqrt(2/pi) / (2 pi r sigma_z(r));
  per road   H(s) = sum over receptor cells of area(r) * C(r - s) (one FFT correlation per sector), averaged over points
             every 5 m along the road. h_iso is the 8-sector mean; h_sector[k] the value with the wind blowing from
             k * 45 degrees; h_index = h_iso / median(h_iso of the region), dimensionless, used in the route cost.
The same kernel family as the engine's CALINE4 dispersion, in its long-term sector form, so it can be computed once per
geometry version and picked per hour by wind direction (scaled by 1 / wind speed).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import time

import numpy as np
import pandas as pd
from scipy.ndimage import map_coordinates
from scipy.signal import fftconvolve

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pack import Pack  # noqa: E402

MAGIC = b"BHH1"
CELL_M = 10.0
CUTOFF_M = 500.0
SIGMA_Z0 = 2.5
SECTORS = 8
SAMPLE_M = 5.0
FACILITY_M2 = 2500.0
DENSE_RADIUS_M = 100.0


def sigma_z(x):
    """Briggs urban class D vertical dispersion (m) with initial mixing, x downwind distance in m."""
    x = np.asarray(x, dtype=float)
    return np.sqrt((0.14 * x / np.sqrt(1 + 0.0003 * x)) ** 2 + SIGMA_Z0 ** 2)


def sector_kernel(k: int, cell: float = CELL_M, cutoff: float = CUTOFF_M) -> np.ndarray:
    """Concentration at receptor offset (rows = north offset ascending, cols = east offset ascending) from a unit source,
    wind 1 m/s blowing FROM k * 360/SECTORS degrees (clockwise from north)."""
    R = int(cutoff // cell)
    off = np.arange(-R, R + 1) * cell
    E, N = np.meshgrid(off, off)
    r = np.hypot(E, N)
    toward = math.radians(k * 360.0 / SECTORS + 180.0)
    bearing = np.arctan2(E, N)  # receptor bearing clockwise from north
    d = np.angle(np.exp(1j * (bearing - toward)))
    dtheta = 2 * math.pi / SECTORS
    inside = (np.abs(d) <= dtheta / 2) & (r <= cutoff)
    re = np.maximum(r, cell / 2)
    K = np.where(inside, math.sqrt(2 / math.pi) / (sigma_z(re) * re * dtheta), 0.0)
    K[R, R] = math.sqrt(2 / math.pi) / (sigma_z(cell / 2) * (cell / 2) * 2 * math.pi)  # source cell: wind-averaged value
    return K


def iso_kernel_value(r):
    r = np.maximum(np.asarray(r, dtype=float), CELL_M / 2)
    return math.sqrt(2 / math.pi) / (2 * math.pi * r * sigma_z(r))


class Raster:
    def __init__(self, bbox, cell=CELL_M):
        w, s, e, n = bbox
        self.lon0, self.lat0 = w, s
        lat_c = math.radians((s + n) / 2)
        self.kx, self.ky = 111320.0 * math.cos(lat_c), 110574.0
        self.cell = cell
        self.nx = int(math.ceil((e - w) * self.kx / cell)) + 1
        self.ny = int(math.ceil((n - s) * self.ky / cell)) + 1

    def ij(self, lon, lat):
        """Fractional (row, col) of points, cell centres at integers."""
        x = (np.asarray(lon) - self.lon0) * self.kx / self.cell - 0.5
        y = (np.asarray(lat) - self.lat0) * self.ky / self.cell - 0.5
        return y, x

    def accumulate(self, lon, lat, w):
        A = np.zeros((self.ny, self.nx), dtype=np.float64)
        y, x = self.ij(lon, lat)
        iy, ix = np.round(y).astype(int), np.round(x).astype(int)
        ok = (iy >= 0) & (iy < self.ny) & (ix >= 0) & (ix < self.nx)
        np.add.at(A, (iy[ok], ix[ok]), np.asarray(w, dtype=float)[ok])
        return A


def correlate(A: np.ndarray, K: np.ndarray) -> np.ndarray:
    """H(s) = sum_r A(r) K(r - s)."""
    return np.maximum(fftconvolve(A, K[::-1, ::-1], mode="same"), 0.0)


def road_samples(p: Pack, rast: Raster):
    """Sample points every SAMPLE_M metres along each road: (rows, cols, owner road index)."""
    ys, xs, own = [], [], []
    for k in range(p.n):
        co = p.coords(k)
        y, x = rast.ij(co[:, 0], co[:, 1])
        pts = [(y[0], x[0])]
        for q in range(len(co) - 1):
            seg = math.hypot((x[q + 1] - x[q]) * rast.cell, (y[q + 1] - y[q]) * rast.cell)
            m = max(1, int(seg // SAMPLE_M))
            for t in range(1, m + 1):
                pts.append((y[q] + (y[q + 1] - y[q]) * t / m, x[q] + (x[q + 1] - x[q]) * t / m))
        ys.extend(a for a, _ in pts); xs.extend(b for _, b in pts); own.extend([k] * len(pts))
    return np.array(ys), np.array(xs), np.array(own)


def per_road(Hmap, ys, xs, own, n):
    v = map_coordinates(Hmap, [ys, xs], order=1, mode="nearest")
    s = np.bincount(own, weights=v, minlength=n)
    c = np.bincount(own, minlength=n)
    return s / np.maximum(c, 1)


def facility_points(path: str | None, bbox):
    if not path:
        return np.zeros(0), np.zeros(0)
    js = json.load(open(path, encoding="utf-8"))
    lon, lat = [], []
    for el in js.get("elements", []):
        t = el.get("tags", {})
        if not (t.get("amenity") in {"school", "kindergarten", "college", "university", "hospital", "clinic", "doctors"}
                or "healthcare" in t):
            continue
        x, y = (el.get("lon"), el.get("lat")) if el.get("type") == "node" else ((el.get("center") or {}).get("lon"), (el.get("center") or {}).get("lat"))
        if x is None or y is None:
            continue
        if bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]:
            lon.append(x); lat.append(y)
    return np.array(lon), np.array(lat)


def write(path: str, cols: dict[str, np.ndarray], header: dict):
    names = list(cols)

    def layout(hl):
        pos, out = 8 + hl, []
        for nme in names:
            pos = (pos + 7) // 8 * 8
            out.append({"name": nme, "dtype": "<f4", "offset": pos, "count": int(cols[nme].size)})
            pos += cols[nme].size * 4
        return out

    header["columns"] = layout(0)
    for _ in range(3):
        header["columns"] = layout(len(json.dumps(header, separators=(",", ":")).encode()))
    head = json.dumps(header, separators=(",", ":")).encode()
    assert header["columns"] == layout(len(head))
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<I", len(head)) + head)
        for c in header["columns"]:
            f.write(b"\0" * (c["offset"] - f.tell()))
            f.write(np.ascontiguousarray(cols[c["name"]], dtype="<f4").tobytes())


CLIENT_MAGIC = b"BHI1"
CLIENT_STEP = 0.01


def write_client(path: str, h_index: np.ndarray, cell_col: np.ndarray, n_cells: int, meta: dict) -> dict:
    """Small file for the map (BHI1): h_index per road in pack order as uint16 (step 0.01), the start of each cell in
    that order (road (c, i) is at cell_offsets[c] + i), and the quintile edges used for the fixed colour classes.

        0 4 magic b"BHI1" | 4 4 uint32 header length H | 8 H JSON header | then n uint16 at an 8-byte boundary
    """
    h = np.asarray(h_index, dtype=float)
    counts = np.bincount(np.asarray(cell_col, dtype=int), minlength=n_cells)
    offsets = np.concatenate([[0], np.cumsum(counts)]).astype(int)
    q = np.quantile(h, [0.2, 0.4, 0.6, 0.8])
    header = dict(meta)
    header.update({"format": "BHI1", "n": int(len(h)), "step": CLIENT_STEP, "cell_offsets": offsets.tolist(),
                   "quintiles": [round(float(x), 3) for x in q]})
    head = json.dumps(header, separators=(",", ":")).encode()
    start = (8 + len(head) + 7) // 8 * 8
    data = np.round(np.clip(h, 0, 655.35) / CLIENT_STEP).astype("<u2")
    with open(path, "wb") as f:
        f.write(CLIENT_MAGIC + struct.pack("<I", len(head)) + head)
        f.write(b"\0" * (start - f.tell()))
        f.write(data.tobytes())
    header["data_offset"] = start
    return header


def read_client(path: str) -> tuple[dict, np.ndarray]:
    raw = open(path, "rb").read()
    assert raw[:4] == CLIENT_MAGIC
    hl = struct.unpack("<I", raw[4:8])[0]
    meta = json.loads(raw[8:8 + hl])
    start = (8 + hl + 7) // 8 * 8
    return meta, np.frombuffer(raw, dtype="<u2", count=meta["n"], offset=start) * meta["step"]


def read(path: str) -> tuple[dict, dict]:
    raw = open(path, "rb").read()
    assert raw[:4] == MAGIC
    hl = struct.unpack("<I", raw[4:8])[0]
    meta = json.loads(raw[8:8 + hl])
    return meta, {c["name"]: np.frombuffer(raw, dtype="<f4", count=c["count"], offset=c["offset"]) for c in meta["columns"]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--buildings", required=True)
    ap.add_argument("--facilities")
    ap.add_argument("--out", required=True)
    ap.add_argument("--client-out", help="also write the small BHI1 file the map reads")
    a = ap.parse_args(argv)
    t0 = time.time()
    p = Pack(a.pack)
    bbox = p.meta["bbox"]
    b = pd.read_parquet(a.buildings)
    fl, fa = facility_points(a.facilities, bbox)
    rast = Raster(bbox)
    A_bld = rast.accumulate(b.lon.values, b.lat.values, b.area_m2.values)
    A = A_bld + rast.accumulate(fl, fa, np.full(len(fl), FACILITY_M2))
    ys, xs, own = road_samples(p, rast)
    t1 = time.time()
    h_sec = np.zeros((SECTORS, p.n))
    for k in range(SECTORS):
        h_sec[k] = per_road(correlate(A, sector_kernel(k)), ys, xs, own, p.n)
    h_iso = h_sec.mean(axis=0)
    # building density within DENSE_RADIUS_M of each road (for the plausibility check), from buildings only
    R = int(DENSE_RADIUS_M // CELL_M)
    off = np.arange(-R, R + 1) * CELL_M
    E, N = np.meshgrid(off, off)
    disk = (np.hypot(E, N) <= DENSE_RADIUS_M).astype(float)
    dens = per_road(correlate(A_bld, disk) / (disk.sum() * CELL_M ** 2), ys, xs, own, p.n)
    med = float(np.median(h_iso))
    h_index = h_iso / med
    t2 = time.time()

    hw = np.array([p.highway(k) for k in range(p.n)])
    local = np.isin(hw, ["residential", "living_street"])
    arterial = np.isin(hw, ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"])
    q25, q75 = np.quantile(dens, [0.25, 0.75])
    dense_local = h_index[local & (dens >= q75)]
    sparse_art = h_index[arterial & (dens <= q25)]
    check = {
        "density_q25": round(float(q25), 4), "density_q75": round(float(q75), 4),
        "dense_local_n": int(dense_local.size), "dense_local_median_h_index": round(float(np.median(dense_local)), 3),
        "sparse_arterial_n": int(sparse_art.size), "sparse_arterial_median_h_index": round(float(np.median(sparse_art)), 3),
        "by_class_median_h_index": {c: round(float(np.median(h_index[hw == c])), 3) for c in pd.Series(hw).value_counts().index[:10]},
    }
    check["passes"] = bool(check["dense_local_median_h_index"] > check["sparse_arterial_median_h_index"])
    header = {
        "format": "BHH1", "geometry": p.meta["geometry"], "region": p.meta["region"], "n": p.n, "order": "road pack (c, i)",
        "median_h_iso": med, "sectors_from_deg": [k * 360 / SECTORS for k in range(SECTORS)],
        "kernel": {"type": "ISC sector-averaged ground-level plume", "sectors": SECTORS, "wind_m_s": 1.0,
                   "sigma_z": "Briggs urban D 0.14x(1+0.0003x)^-0.5", "sigma_z0_m": SIGMA_Z0, "cutoff_m": CUTOFF_M,
                   "cell_m": CELL_M, "sample_m": SAMPLE_M},
        "receptors": {"buildings": int(len(b)), "building_area_km2": round(float(b.area_m2.sum()) / 1e6, 3),
                      "facilities": int(len(fl)), "facility_equivalent_m2": FACILITY_M2},
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    write(tmp, {"h_index": h_index, "h_iso": h_iso, "h_sector": h_sec.reshape(-1), "density_100m": dens}, header)
    os.replace(tmp, a.out)
    if a.client_out:
        os.makedirs(os.path.dirname(a.client_out), exist_ok=True)
        write_client(a.client_out, h_index, p.cols["c"], len(p.meta["cells"]),
                     {"geometry": p.meta["geometry"], "name": os.path.basename(a.client_out)[: -len(".bin")],
                      "median_h_iso": med, "source": "vayu/field/harga_hirup.py"})
    rep = {"out": a.out, "bytes": os.path.getsize(a.out), "roads": p.n, "samples": int(len(own)),
           "raster": [rast.ny, rast.nx], "receptors": header["receptors"], "median_h_iso": med,
           "h_index_quantiles": [round(float(x), 3) for x in np.quantile(h_index, [0.05, 0.25, 0.5, 0.75, 0.95])],
           "check": check, "seconds": {"prepare": round(t1 - t0, 1), "kernels": round(t2 - t1, 1), "total": round(time.time() - t0, 1)}}
    with open(a.out[: -len(".bin")] + ".json", "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    print(json.dumps(rep))
    return rep


if __name__ == "__main__":
    main()
