"""Roads of an administrative area straight from an OSM .pbf (GDAL OSM driver through pyogrio), offline.

    python vayu/field/extract_osm_region.py --pbf D:/breeva-osm-data/java-260515.osm.pbf --admin "Kota Bogor" \
        --bbox 106.70,-6.70,106.88,-6.50 --inherit jakarta --out D:/breeva-ml-data/field/osm/bogor_roads.parquet

Keeps the highway classes present in the road_segments backup. Attributes OSM does not carry (traffic_base_estimate,
traffic_calibration_factor, canyon_ratio, width when untagged) are inherited per highway class as the median of the
--inherit region of the backup; the report says how many roads got inherited values.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely

BACKUP = "D:/breeva-ml-data/backup_2026-11-14/road_segments.csv.gz"


def other_tag(s: str | None, key: str) -> str | None:
    if not isinstance(s, str):
        return None
    m = re.search(r'"' + re.escape(key) + r'"=>"([^"]*)"', s)
    return m.group(1) if m else None


def num(v) -> float | None:
    if v is None:
        return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", str(v))
    return float(m.group(1)) if m else None


def class_medians(region: str) -> tuple[pd.DataFrame, set[str]]:
    parts = []
    for ch in pd.read_csv(BACKUP, usecols=["highway", "region", "width", "canyon_ratio", "traffic_base_estimate",
                                           "traffic_calibration_factor"], chunksize=300_000):
        parts.append(ch[ch.region == region])
    df = pd.concat(parts)
    classes = set(pd.read_csv(BACKUP, usecols=["highway"], nrows=2_000_000).highway.dropna().unique())
    return df.groupby("highway")[["width", "canyon_ratio", "traffic_base_estimate", "traffic_calibration_factor"]].median(), classes


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--admin", required=True, help="exact OSM name of the boundary; several names separated by commas are unioned"
                    " (e.g. the six kecamatan of Kota Bogor when the city boundary is missing from the extract)")
    ap.add_argument("--bbox", required=True, help="west,south,east,north search box around the area")
    ap.add_argument("--inherit", required=True, help="backup region whose per-class medians fill missing attributes")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    t0 = time.time()
    polys = pyogrio.read_dataframe(a.pbf, layer="multipolygons", bbox=bbox, columns=["name", "boundary", "admin_level", "osm_id", "osm_way_id"],
                                   where="boundary = 'administrative' AND name IN (" + ",".join("'" + n.strip().replace("'", "") + "'" for n in a.admin.split(",")) + ")")
    if polys.empty:
        raise SystemExit(f"no administrative boundary named {a.admin!r} in {bbox}")
    area = polys.geometry.union_all() if hasattr(polys.geometry, "union_all") else shapely.union_all(polys.geometry.values)
    t1 = time.time()
    lines = pyogrio.read_dataframe(a.pbf, layer="lines", bbox=bbox, columns=["osm_id", "name", "highway", "other_tags"],
                                   where="highway IS NOT NULL")
    t2 = time.time()
    medians, classes = class_medians(a.inherit)
    lines = lines[lines.highway.isin(classes)]
    inside = lines[lines.geometry.intersects(area)].copy()
    inside = inside[inside.geometry.geom_type == "LineString"]
    rows = pd.DataFrame({
        "osm_way_id": inside.osm_id.astype("int64"),
        "highway": inside.highway,
        "name": inside.name,
        "lanes": [num(other_tag(t, "lanes")) for t in inside.other_tags],
        "width_tag": [num(other_tag(t, "width")) for t in inside.other_tags],
        "surface": [other_tag(t, "surface") for t in inside.other_tags],
        "maxspeed": [other_tag(t, "maxspeed") for t in inside.other_tags],
    })
    med = medians.reindex(rows.highway)
    rows["width"] = np.where(rows.width_tag.notna(), rows.width_tag, med.width.values)
    rows["canyon_ratio"] = med.canyon_ratio.values
    rows["traffic_base_estimate"] = med.traffic_base_estimate.values
    rows["traffic_calibration_factor"] = med.traffic_calibration_factor.values
    rows["wkb"] = shapely.to_wkb(inside.geometry.values)
    rows = rows.drop(columns=["width_tag"]).reset_index(drop=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    rows.to_parquet(a.out, index=False)
    rep = {
        "admin": a.admin, "boundary_parts": len(polys), "parts_found": sorted(polys.name.unique().tolist()),
        "admin_levels": sorted(set(map(str, polys.admin_level))),
        "boundary_area_km2": round(gpd.GeoSeries([area], crs=4326).to_crs(32748).area.iloc[0] / 1e6, 2),
        "roads": int(len(rows)), "by_class": rows.highway.value_counts().to_dict(),
        "inherited_from": a.inherit, "width_tagged": int(inside.other_tags.astype(str).str.contains('"width"').sum()),
        "lanes_tagged": int(rows.lanes.notna().sum()), "named": int(rows.name.notna().sum()),
        "seconds": {"boundary": round(t1 - t0, 1), "lines": round(t2 - t1, 1), "total": round(time.time() - t0, 1)},
        "boundary_wkt_bounds": list(area.bounds),
    }
    json.dump(rep, open(a.out.replace(".parquet", ".json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
