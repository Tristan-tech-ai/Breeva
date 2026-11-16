"""Building footprints of a box straight from an OSM .pbf (GDAL OSM driver through pyogrio), offline.

    python vayu/field/extract_buildings.py --pbf D:/breeva-osm-data/nusa-tenggara-260515.osm.pbf \
        --bbox 115.08,-8.82,115.3,-8.56 --epsg 32750 --out D:/breeva-ml-data/field/osm/badung_denpasar_buildings.parquet

Writes one row per building polygon: centroid lon/lat, footprint area in m2 (in the given UTM zone), building tag, amenity.
"""
from __future__ import annotations

import argparse
import json
import os
import time

import pyogrio


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--bbox", required=True, help="west,south,east,north")
    ap.add_argument("--epsg", type=int, required=True, help="metric CRS for areas, e.g. 32750 (UTM 50S) for Bali")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    t0 = time.time()
    df = pyogrio.read_dataframe(a.pbf, layer="multipolygons", bbox=bbox, columns=["osm_id", "osm_way_id", "building", "amenity"],
                                where="building IS NOT NULL")
    t1 = time.time()
    metric = df.geometry.to_crs(a.epsg)
    cen = metric.centroid.to_crs(4326)
    out = df[["building", "amenity"]].copy()
    out["area_m2"] = metric.area.values
    out["lon"] = cen.x.values
    out["lat"] = cen.y.values
    w, s, e, n = bbox
    out = out[(out.lon >= w) & (out.lon <= e) & (out.lat >= s) & (out.lat <= n)].reset_index(drop=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    out.to_parquet(a.out, index=False)
    rep = {"bbox": bbox, "buildings": int(len(out)), "area_km2": round(float(out.area_m2.sum()) / 1e6, 3),
           "median_area_m2": round(float(out.area_m2.median()), 1), "by_tag": out.building.value_counts().head(12).to_dict(),
           "seconds": {"read": round(t1 - t0, 1), "total": round(time.time() - t0, 1)}}
    json.dump(rep, open(a.out.replace(".parquet", ".json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
