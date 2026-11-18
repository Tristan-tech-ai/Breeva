# -*- coding: utf-8 -*-
"""POI pack per field region (F1-69): the named places of the Overture Maps 'places' theme AND of OpenStreetMap inside the
region, mapped to Breeva's POI categories, one compact JSON per region for the CDN (tiles/poi/<release>/<region>.json)
and the offline save. Overture alone missed places that OSM has (Royal Padjadjaran Hotel, Kopi Tuku) and filed some under
wrong categories (a mosque as real_estate_service), so Indonesian name keywords decide the category when they match.

Why: the map showed two POI sets (the OSM basemap's icons and ours) and ours was incomplete (the Geoapify proxy returns
at most 100 places per view). Overture places are open data (CDLA Permissive 2.0 / Apache 2.0 / CC0 per provider,
https://docs.overturemaps.org/attribution/), so the pack may sit on our CDN and work offline.

Usage (DuckDB with httpfs; reads the public Overture bucket, no key):
  python -I scripts/field/build_poi_pack.py <out_dir> [release=2026-10-21.0]
Writes <out_dir>/<region>.json and <out_dir>/ringkasan.json (counts per category, before and after dedupe).
"""
import json
import math
import re
import sys
import time
import unicodedata

import duckdb

RELEASE = sys.argv[2] if len(sys.argv) > 2 else "2026-10-21.0"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
MIN_CONFIDENCE = 0.6
DEDUPE_M = 30.0
MERGE_M = 50.0  # the same name from OSM and Overture within this distance is one place (OSM kept)
MIN_CONFIDENCE_PUBLIC = 0.5  # Overture rates many schools, mosques and clinics low; a public-facility name keeps them
OVERPASS = "https://overpass-api.de/api/interpreter"
# same bounds as src/lib/field/source.ts FIELD_REGIONS, plus 0.02 degrees (the basemap margin)
REGIONS = {
    "badung_denpasar": (-8.82 - 0.02, 115.08 - 0.02, -8.56 + 0.02, 115.30 + 0.02),
    "kota_bogor": (-6.6813 - 0.02, 106.7348 - 0.02, -6.5143 + 0.02, 106.8486 + 0.02),
}
# Overture basic_category -> Breeva/Geoapify-style category path (src/lib/poi-icons.ts understands these)
CATEGORY = {
    "restaurant": "catering.restaurant", "casual_eatery": "catering.restaurant", "food_and_drink": "catering.restaurant",
    "food_truck_stand": "catering.fast_food", "fast_food_restaurant": "catering.fast_food", "bar": "catering.bar",
    "coffee_shop": "catering.cafe", "cafe": "catering.cafe", "smoothie_juice_bar": "catering.cafe",
    "non_alcoholic_beverage_venue": "catering.cafe",
    "hotel": "accommodation.hotel", "resort": "accommodation.hotel", "lodging": "accommodation.guest_house",
    "private_lodging": "accommodation.guest_house", "bed_and_breakfast": "accommodation.guest_house",
    "convenience_store": "commercial.convenience", "food_and_beverage_store": "commercial.food_and_drink",
    "shopping_mall": "commercial.shopping_mall", "department_store": "commercial.department_store",
    "warehouse_club_store": "commercial.supermarket", "farmers_market": "commercial.marketplace", "shopping": "commercial.marketplace",
    "fashion_and_apparel_store": "commercial.clothing", "electronics_store": "commercial.electronics",
    "hardware_home_and_garden_store": "commercial.hardware", "books_music_and_video_store": "commercial.books",
    "personal_care_and_beauty_store": "commercial.beauty", "toys_and_games_store": "commercial.toys",
    "sporting_goods_store": "commercial.outdoor_and_sport", "animal_and_pet_store": "commercial.pet",
    "flowers_and_gifts_store": "commercial.gift_and_souvenir",
    "muslim_place_of_worship": "religion.place_of_worship.islam", "hindu_place_of_worship": "religion.place_of_worship.hinduism",
    "christian_place_of_worship": "religion.place_of_worship.christianity", "buddhist_place_of_worship": "religion.place_of_worship.buddhism",
    "atm": "service.financial.atm", "bank_or_credit_union": "service.financial.bank",
    "gas_station": "service.vehicle.fuel", "fueling_station": "service.vehicle.fuel", "police_station": "service.police",
    "preschool": "education.kindergarten", "elementary_school": "education.school", "middle_school": "education.school",
    "high_school": "education.school", "specialty_school": "education.school", "college_university": "education.university",
    "library": "education.library",
    "hospital": "healthcare.hospital", "pharmacy_and_drug_store": "healthcare.pharmacy", "dental_clinic": "healthcare.dentist",
    "outpatient_care_facility": "healthcare.clinic", "primary_care_or_general_clinic": "healthcare.clinic",
    "health_care": "healthcare.clinic", "medical_service": "healthcare.clinic",
    "park": "leisure.park", "playground": "leisure.playground", "gym": "leisure.fitness", "fitness_studio": "leisure.fitness",
    "swimming_pool": "leisure.swimming", "sport_or_fitness_facility": "leisure.sport",
    "museum": "entertainment.museum", "movie_theater": "entertainment.cinema", "art_gallery": "entertainment.culture",
    "historic_site": "tourism.sights", "public_transit_facility_or_service": "public_transport.bus",
}

# Indonesian name keywords that decide the category (public facilities), checked at the start of the name
NAME_RULES = [
    (r"^(masjid|mesjid|musholl?a|mushola|musala|surau|langgar)\b", "religion.place_of_worship.islam"),
    (r"^pura\b", "religion.place_of_worship.hinduism"),
    (r"^(gereja|gki|gkj|gpdi|gbi|hkbp|gpib|katedral)\b", "religion.place_of_worship.christianity"),
    (r"^(vihara|wihara|klenteng|kelenteng)\b", "religion.place_of_worship.buddhism"),
    (r"^(spbu|pertamina)\b", "service.vehicle.fuel"),
    (r"^(universitas|institut|politeknik|sekolah tinggi|akademi)\b", "education.university"),
    (r"^(tk|paud|ra)\b", "education.kindergarten"),
    (r"^(sd|sdn|smp|smpn|sma|sman|smk|smkn|mi|min|mts|mtsn|ma|man|sekolah|slb)\b", "education.school"),
    (r"^(rumah sakit|rs|rsu|rsud|rsup|rsia|rsau|rsad)\b", "healthcare.hospital"),
    (r"^(puskesmas|klinik|posyandu|pustu|balai pengobatan)\b", "healthcare.clinic"),
    (r"^(apotek|apotik)\b", "healthcare.pharmacy"),
    (r"^pasar\b", "commercial.marketplace"),
    (r"^(taman|lapangan)\b", "leisure.park"),
    (r"^atm\b", "service.financial.atm"),
    (r"^bank\b", "service.financial.bank"),
]


# keywords that also start hotel, restaurant or housing names ("Taman Sari Guest House"): they decide only when the
# source category is unknown or already a shop/park
AMBIGUOUS = ("commercial.marketplace", "leisure.park")


def name_category(name, source_cat=None):
    n = name.strip().lower()
    for pat, cat in NAME_RULES:
        if re.search(pat, n):
            if cat in AMBIGUOUS and source_cat and not source_cat.startswith(("commercial", "leisure")):
                return None
            return cat
    return None


OSM_TAG = {
    ("amenity", "restaurant"): "catering.restaurant", ("amenity", "food_court"): "catering.restaurant",
    ("amenity", "fast_food"): "catering.fast_food", ("amenity", "cafe"): "catering.cafe", ("amenity", "ice_cream"): "catering.cafe",
    ("amenity", "bar"): "catering.bar", ("amenity", "pub"): "catering.bar",
    ("amenity", "school"): "education.school", ("amenity", "kindergarten"): "education.kindergarten",
    ("amenity", "college"): "education.college", ("amenity", "university"): "education.university", ("amenity", "library"): "education.library",
    ("amenity", "hospital"): "healthcare.hospital", ("amenity", "clinic"): "healthcare.clinic", ("amenity", "doctors"): "healthcare.clinic",
    ("amenity", "dentist"): "healthcare.dentist", ("amenity", "pharmacy"): "healthcare.pharmacy",
    ("amenity", "bank"): "service.financial.bank", ("amenity", "atm"): "service.financial.atm", ("amenity", "fuel"): "service.vehicle.fuel",
    ("amenity", "police"): "service.police", ("amenity", "cinema"): "entertainment.cinema", ("amenity", "marketplace"): "commercial.marketplace",
    ("amenity", "bus_station"): "public_transport.bus",
    ("shop", "supermarket"): "commercial.supermarket", ("shop", "convenience"): "commercial.convenience", ("shop", "mall"): "commercial.shopping_mall",
    ("shop", "department_store"): "commercial.department_store", ("shop", "clothes"): "commercial.clothing", ("shop", "electronics"): "commercial.electronics",
    ("shop", "mobile_phone"): "commercial.electronics", ("shop", "hardware"): "commercial.hardware", ("shop", "doityourself"): "commercial.hardware",
    ("shop", "books"): "commercial.books", ("shop", "beauty"): "commercial.beauty", ("shop", "cosmetics"): "commercial.beauty",
    ("shop", "toys"): "commercial.toys", ("shop", "sports"): "commercial.outdoor_and_sport", ("shop", "pet"): "commercial.pet",
    ("shop", "gift"): "commercial.gift_and_souvenir", ("shop", "bakery"): "commercial.food_and_drink", ("shop", "chemist"): "healthcare.pharmacy",
    ("tourism", "hotel"): "accommodation.hotel", ("tourism", "guest_house"): "accommodation.guest_house", ("tourism", "hostel"): "accommodation.hostel",
    ("tourism", "motel"): "accommodation.motel", ("tourism", "apartment"): "accommodation.apartment", ("tourism", "museum"): "entertainment.museum",
    ("tourism", "attraction"): "tourism.attraction",
    ("leisure", "park"): "leisure.park", ("leisure", "playground"): "leisure.playground", ("leisure", "garden"): "leisure.garden",
    ("leisure", "fitness_centre"): "leisure.fitness", ("leisure", "sports_centre"): "leisure.sport", ("leisure", "swimming_pool"): "leisure.swimming",
}
RELIGION = {"muslim": "religion.place_of_worship.islam", "hindu": "religion.place_of_worship.hinduism",
            "christian": "religion.place_of_worship.christianity", "buddhist": "religion.place_of_worship.buddhism"}


def osm_category(tags):
    if tags.get("amenity") == "place_of_worship":
        return RELIGION.get(tags.get("religion", ""), "religion.place_of_worship")
    for k in ("amenity", "shop", "tourism", "leisure"):
        c = OSM_TAG.get((k, tags.get(k, "")))
        if c:
            return c
    hc = tags.get("healthcare")
    if hc in ("hospital", "clinic", "doctor", "pharmacy", "dentist", "centre"):
        return {"hospital": "healthcare.hospital", "pharmacy": "healthcare.pharmacy", "dentist": "healthcare.dentist"}.get(hc, "healthcare.clinic")
    return None


def osm_places(s, w, n, e):
    """Named shops, amenities, tourism and leisure places of OSM in the box (Overpass, ODbL)."""
    import urllib.parse
    import urllib.request
    box = f"({s},{w},{n},{e})"
    leis = 'nwr[name][leisure~"^(park|playground|garden|fitness_centre|sports_centre|swimming_pool)$"]'
    q = (f"[out:json][timeout:180];(nwr[name][amenity]{box};nwr[name][shop]{box};nwr[name][tourism]{box};"
         f"{leis}{box};nwr[name][healthcare]{box};);out center tags;")
    req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "breeva-poi-pack/1.0"})
    js = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                js = json.load(r)
            break
        except Exception as ex:  # Overpass is busy at times: wait and retry
            print("overpass", attempt + 1, str(ex)[:120], flush=True)
            time.sleep(20 * (attempt + 1))
    if js is None:
        raise SystemExit("Overpass tidak menjawab")
    out = []
    for el in js.get("elements", []):
        tags = el.get("tags", {})
        name = (tags.get("name") or "").strip()
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lng = el.get("lon", (el.get("center") or {}).get("lon"))
        cat = osm_category(tags) or name_category(name)  # OSM tags are curated: they come first
        if not name or lat is None or not cat:
            continue
        addr = " ".join(x for x in [tags.get("addr:street", ""), tags.get("addr:housenumber", "")] if x).strip()
        out.append({"name": name, "cat": cat, "lat": lat, "lng": lng, "addr": addr, "confidence": 2.0, "src": "osm", "ds": ["OpenStreetMap"]})
    return out


def norm(name):
    s = unicodedata.normalize("NFKD", name).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def dedupe(rows, dist_m=DEDUPE_M):
    """Drop a place when a kept place with the same normalised name lies within dist_m (highest confidence kept; OSM
    rows carry confidence 2 so they win over Overture)."""
    kept, grid = [], {}
    cell = dist_m / 111_000.0
    for r in sorted(rows, key=lambda r: -r["confidence"]):
        key = norm(r["name"])
        gx, gy = int(r["lng"] / cell), int(r["lat"] / cell)
        dup = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in grid.get((key, gx + dx, gy + dy), []):
                    dlat = (o["lat"] - r["lat"]) * 111_000.0
                    dlng = (o["lng"] - r["lng"]) * 111_000.0 * math.cos(math.radians(r["lat"]))
                    if dlat * dlat + dlng * dlng <= dist_m * dist_m:
                        dup = True
        if not dup:
            kept.append(r)
            grid.setdefault((key, gx, gy), []).append(r)
    return kept


def main():
    t0 = time.time()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    src = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
    summary = {"release": RELEASE, "min_confidence": MIN_CONFIDENCE, "dedupe_m": DEDUPE_M, "regions": {}}
    for region, (s, w, n, e) in REGIONS.items():
        q = f"""select names.primary as name, basic_category as kat, confidence, operating_status as st,
                       addresses[1].freeform as addr, (bbox.ymin + bbox.ymax) / 2 as lat, (bbox.xmin + bbox.xmax) / 2 as lng,
                       list_distinct(list_transform(sources, lambda x: x.dataset)) as ds
                from read_parquet('{src}', hive_partitioning=1)
                where bbox.xmin >= {w} and bbox.xmax <= {e} and bbox.ymin >= {s} and bbox.ymax <= {n}"""
        rows = con.execute(q).fetchdf().to_dict("records")
        total = len(rows)
        keep = []
        for r in rows:
            name = (r["name"] or "").strip()
            if not name or r["st"] in ("permanently_closed", "temporarily_closed"):
                continue
            by_name = name_category(name, CATEGORY.get(r["kat"]))
            cat = by_name or CATEGORY.get(r["kat"])
            need = MIN_CONFIDENCE_PUBLIC if by_name else MIN_CONFIDENCE
            if cat and (r["confidence"] or 0) >= need:
                r["cat"], r["src"] = cat, "overture"
                keep.append(r)
        n_overture = len(keep)
        osm = osm_places(s, w, n, e)
        before = n_overture + len(osm)
        keep = dedupe(dedupe(keep) + osm, MERGE_M)
        cats = sorted({r["cat"] for r in keep})
        ci = {c: i for i, c in enumerate(cats)}
        keep.sort(key=lambda r: (r["lat"], r["lng"]))
        providers = {}
        for r in keep:
            for d in (r["ds"] if r["ds"] is not None else []):
                providers[d] = providers.get(d, 0) + 1
        pack = {
            "format": "breeva_poi", "v": 1, "region": region, "release": RELEASE,
            "source": "Overture Maps Foundation places theme + OpenStreetMap (Overpass)", "attribution": "© OpenStreetMap contributors, Overture Maps Foundation; data from " + ", ".join(sorted(providers)),
            "cats": cats,
            # [name, category index, lat*1e5, lng*1e5, address or ""]
            "pois": [[r["name"].strip()[:80], ci[r["cat"]], round(r["lat"] * 1e5), round(r["lng"] * 1e5), (r["addr"] or "")[:100]] for r in keep],
        }
        with open(f"{OUT}/{region}.json", "w", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
        per_cat = {}
        for r in keep:
            per_cat[r["cat"]] = per_cat.get(r["cat"], 0) + 1
        summary["regions"][region] = {"overture_total": total, "overture_kept": n_overture, "osm": len(osm), "kept_before_dedupe": before,
                                      "kept": len(keep), "from_osm": sum(1 for r in keep if r["src"] == "osm"),
                                      "per_category": dict(sorted(per_cat.items(), key=lambda kv: -kv[1])), "providers": providers}
        print(f"{region}: Overture {total} -> {n_overture}, OSM {len(osm)}, gabungan sesudah dedupe {len(keep)} ({time.time() - t0:.0f} s)", flush=True)
    with open(f"{OUT}/ringkasan.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
