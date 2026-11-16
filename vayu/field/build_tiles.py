"""Road geometry as PMTiles (LAMPIRAN_TEKNIS L1.2) from a road pack.

    python vayu/field/build_tiles.py --pack D:/breeva-ml-data/field/packs/2026-11/badung_denpasar.bin \
        --out D:/breeva-ml-data/field/tiles/2026-11/badung_denpasar.pmtiles

Layer "roads", zoom 10-14 (the client overzooms to 18). Attributes: c (cell), i (index in cell), h (highway code of the
pack), n (name, zoom >= 13 only). Filtering: z10-11 motorway to secondary, z12 up to tertiary, z13+ all roads.
Pure Python (shapely + mapbox-vector-tile + pmtiles), so it runs without Docker or tippecanoe.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time

import mapbox_vector_tile
import numpy as np
import shapely
from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pack import Pack  # noqa: E402

R = 6378137.0
WORLD = 2 * math.pi * R
EXTENT = 4096
BUFFER_PX = 64
MIN_ZOOM, MAX_ZOOM = 10, 14
MAJOR = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"}
UP_TO_TERTIARY = MAJOR | {"tertiary", "tertiary_link"}


def merc(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = np.radians(lon) * R
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
    return x, y


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = WORLD / 2 ** z
    minx = -WORLD / 2 + x * size
    maxy = WORLD / 2 - y * size
    return minx, maxy - size, minx + size, maxy


def tile_range(z: int, minx: float, miny: float, maxx: float, maxy: float) -> tuple[range, range]:
    size = WORLD / 2 ** z
    x0 = int(math.floor((minx + WORLD / 2) / size))
    x1 = int(math.floor((maxx + WORLD / 2) / size))
    y0 = int(math.floor((WORLD / 2 - maxy) / size))
    y1 = int(math.floor((WORLD / 2 - miny) / size))
    return range(x0, x1 + 1), range(y0, y1 + 1)


def keep_at(z: int, highway: str) -> bool:
    if z <= 11:
        return highway in MAJOR
    if z == 12:
        return highway in UP_TO_TERTIARY
    return True


def build(pack_path: str, out_path: str) -> dict:
    t0 = time.time()
    p = Pack(pack_path)
    geoms, hws, props = [], [], []
    for k in range(p.n):
        co = p.coords(k)
        x, y = merc(co[:, 0], co[:, 1])
        geoms.append(shapely.linestrings(np.column_stack([x, y])))
        hw = p.highway(k)
        hws.append(hw)
        props.append({"c": int(p.cols["c"][k]), "i": int(p.cols["i"][k]), "h": int(p.cols["hw"][k]), "n": p.string("name", k)})
    geoms = np.array(geoms, dtype=object)
    tree = shapely.STRtree(geoms)
    minx, miny, maxx, maxy = shapely.total_bounds(geoms)

    tiles: list[tuple[int, bytes]] = []
    per_zoom = {}
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        xs, ys = tile_range(z, minx, miny, maxx, maxy)
        size = WORLD / 2 ** z
        buf = size * BUFFER_PX / EXTENT
        tol = 0.0 if z == MAX_ZOOM else size / EXTENT * 0.5  # half a tile unit
        n_tiles = n_feat = 0
        for tx in xs:
            for ty in ys:
                b = tile_bounds(z, tx, ty)
                box = (b[0] - buf, b[1] - buf, b[2] + buf, b[3] + buf)
                idx = tree.query(shapely.box(*box))
                feats = []
                for k in sorted(int(j) for j in idx):
                    if not keep_at(z, hws[k]):
                        continue
                    g = shapely.clip_by_rect(geoms[k], *box)
                    if g.is_empty:
                        continue
                    if tol:
                        g = shapely.simplify(g, tol, preserve_topology=False)
                    pr = {"c": props[k]["c"], "i": props[k]["i"], "h": props[k]["h"]}
                    if z >= 13 and props[k]["n"]:
                        pr["n"] = props[k]["n"]
                    feats.append({"geometry": g, "properties": pr})
                if not feats:
                    continue
                data = mapbox_vector_tile.encode(
                    [{"name": "roads", "features": feats}],
                    default_options={"quantize_bounds": b, "extents": EXTENT, "y_coord_down": False},
                )
                tiles.append((zxy_to_tileid(z, tx, ty), gzip.compress(data, mtime=0)))
                n_tiles += 1
                n_feat += len(feats)
        per_zoom[z] = {"tiles": n_tiles, "features": n_feat}
    tiles.sort(key=lambda t: t[0])

    w, s, e, n = p.meta["bbox"]
    lon0, lat0 = (minx / R) * 180 / math.pi, math.degrees(2 * math.atan(math.exp(miny / R)) - math.pi / 2)
    lon1, lat1 = (maxx / R) * 180 / math.pi, math.degrees(2 * math.atan(math.exp(maxy / R)) - math.pi / 2)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "wb") as f:
        wr = Writer(f)
        for tid, data in tiles:
            wr.write_tile(tid, data)
        wr.finalize(
            {
                "tile_compression": Compression.GZIP, "tile_type": TileType.MVT, "min_zoom": MIN_ZOOM, "max_zoom": MAX_ZOOM,
                "min_lon_e7": int(lon0 * 1e7), "min_lat_e7": int(lat0 * 1e7), "max_lon_e7": int(lon1 * 1e7),
                "max_lat_e7": int(lat1 * 1e7), "center_zoom": 12,
                "center_lon_e7": int((w + e) / 2 * 1e7), "center_lat_e7": int((s + n) / 2 * 1e7),
            },
            {
                "name": f"breeva roads {p.meta['region']}", "format": "pbf", "geometry": p.meta["geometry"],
                "attribution": "© OpenStreetMap contributors",
                "vector_layers": [{"id": "roads", "minzoom": MIN_ZOOM, "maxzoom": MAX_ZOOM,
                                   "fields": {"c": "Number", "i": "Number", "h": "Number", "n": "String"}}],
                "highway_codes": p.meta["highway_codes"],
            },
        )
    os.replace(tmp, out_path)
    return {"per_zoom": per_zoom, "tiles": len(tiles), "bytes": os.path.getsize(out_path), "seconds": round(time.time() - t0, 1)}


def verify(pmtiles_path: str, pack_path: str) -> dict:
    """Read the archive back with the pmtiles reader and count unique (c, i) per zoom."""
    p = Pack(pack_path)
    with open(pmtiles_path, "rb") as f:
        rd = Reader(MmapSource(f))
        h = rd.header()
        meta = rd.metadata()
        uniq = {}
        names_below_13 = 0
        major_codes = {p.meta["highway_codes"].index(x) for x in MAJOR if x in p.meta["highway_codes"]}
        minor_at_low = 0
        for z in range(h["min_zoom"], h["max_zoom"] + 1):
            xs, ys = tile_range(z, *merc_bounds(p))
            seen = set()
            for tx in xs:
                for ty in ys:
                    data = rd.get(z, tx, ty)
                    if not data:
                        continue
                    tile = mapbox_vector_tile.decode(gzip.decompress(data))
                    for ft in tile.get("roads", {}).get("features", []):
                        pr = ft["properties"]
                        seen.add((pr["c"], pr["i"]))
                        if z < 13 and "n" in pr:
                            names_below_13 += 1
                        if z <= 11 and pr["h"] not in major_codes:
                            minor_at_low += 1
            uniq[z] = len(seen)
    return {"min_zoom": h["min_zoom"], "max_zoom": h["max_zoom"], "unique_per_zoom": uniq, "pack_roads": p.n,
            "names_below_z13": names_below_13, "minor_roads_at_z10_11": minor_at_low,
            "layers": [l["id"] for l in meta.get("vector_layers", [])]}


def merc_bounds(p: Pack) -> tuple[float, float, float, float]:
    xy = p.cols["coords"].reshape(-1, 2) / p.meta["coord_scale"]
    x, y = merc(xy[:, 0], xy[:, 1])
    return float(x.min()), float(y.min()), float(x.max()), float(y.max())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    rep = build(a.pack, a.out)
    rep["verify"] = verify(a.out, a.pack)
    with open(a.out[: -len(".pmtiles")] + ".json", "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
