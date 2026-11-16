"""Schools and health facilities of a box straight from an OSM .pbf, written in the Overpass JSON shape that
harga_hirup.py --facilities reads (nodes with lat/lon, areas with a centre).

    python vayu/field/extract_facilities.py --pbf D:/breeva-osm-data/java-260515.osm.pbf --bbox 106.7348,-6.6813,106.8486,-6.5143 \
        --out D:/breeva-ml-data/field/osm/kota_bogor_facilities.json
"""
from __future__ import annotations

import argparse
import json
import re

import pyogrio

AMENITY = ("school", "kindergarten", "college", "university", "hospital", "clinic", "doctors")


def tag(other: str | None, key: str) -> str | None:
    if not isinstance(other, str):
        return None
    m = re.search(r'"' + re.escape(key) + r'"=>"([^"]*)"', other)
    return m.group(1) if m else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--bbox", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    elements = []
    pts = pyogrio.read_dataframe(a.pbf, layer="points", bbox=bbox, columns=["osm_id", "name", "other_tags"],
                                 where="other_tags LIKE '%\"amenity\"=>%' OR other_tags LIKE '%\"healthcare\"=>%'")
    for r in pts.itertuples():
        am, hc = tag(r.other_tags, "amenity"), tag(r.other_tags, "healthcare")
        if am in AMENITY or hc:
            tags = {k: v for k, v in (("amenity", am), ("healthcare", hc), ("name", r.name)) if v}
            elements.append({"type": "node", "id": int(r.osm_id), "lat": r.geometry.y, "lon": r.geometry.x, "tags": tags})
    polys = pyogrio.read_dataframe(a.pbf, layer="multipolygons", bbox=bbox, columns=["osm_id", "osm_way_id", "name", "amenity", "other_tags"],
                                   where="amenity IN (" + ",".join("'" + x + "'" for x in AMENITY) + ") OR other_tags LIKE '%\"healthcare\"=>%'")
    for r in polys.itertuples():
        c = r.geometry.representative_point()
        hc = tag(r.other_tags, "healthcare")
        tags = {k: v for k, v in (("amenity", r.amenity), ("healthcare", hc), ("name", r.name)) if v}
        oid = r.osm_way_id if r.osm_way_id is not None else r.osm_id
        elements.append({"type": "way", "id": int(float(oid)), "center": {"lat": c.y, "lon": c.x}, "tags": tags})
    w, s, e, n = bbox
    inside = [el for el in elements
              if w <= (el.get("lon") or el["center"]["lon"]) <= e and s <= (el.get("lat") or el["center"]["lat"]) <= n]
    json.dump({"source": "OpenStreetMap (ODbL), " + a.pbf.split("/")[-1], "elements": inside}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
    kinds = {}
    for el in inside:
        k = el["tags"].get("amenity") or "healthcare:" + el["tags"].get("healthcare", "?")
        kinds[k] = kinds.get(k, 0) + 1
    print(json.dumps({"facilities": len(inside), "by_kind": kinds}))


if __name__ == "__main__":
    main()
