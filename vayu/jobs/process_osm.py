"""
VAYU Engine — OSM Road Segment Processor
=========================================
Queries Overpass API for road data per region, enriches with landuse/building
data, and UPSERTs to Supabase road_segments table.

Usage:
    python jobs/process_osm.py --region bali
    python jobs/process_osm.py --region jakarta
    python jobs/process_osm.py --all
    python jobs/process_osm.py --all --dry-run

Requirements:
    - requests (Overpass API + Supabase REST API)
    - shapely (geometry processing)
    - rtree (spatial indexing)
"""

import argparse
import json
import logging
import math
import os
import sys
import time
from dataclasses import dataclass

import requests
from rtree import index as rtree_index
from shapely.geometry import LineString, Point, shape
from shapely.ops import transform

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("process_osm")

# ============================================================
# REGION DEFINITIONS (bounding boxes)
# ============================================================

@dataclass
class Region:
    name: str
    south: float
    west: float
    north: float
    east: float

REGIONS: dict[str, Region] = {
    # --- Bali ---
    "bali": Region("bali", -8.78, 115.10, -8.55, 115.30),             # Denpasar-Kuta-Ubud-Sanur
    "bali-badung": Region("bali", -8.85, 115.05, -8.55, 115.20),      # Kab. Badung (south-west, overlaps handled by on_conflict)
    "bali-gianyar": Region("bali", -8.60, 115.25, -8.35, 115.45),     # Kab. Gianyar
    "bali-karangasem": Region("bali", -8.55, 115.40, -8.30, 115.72),  # Kab. Karangasem (east Bali)
    "bali-klungkung": Region("bali", -8.60, 115.35, -8.45, 115.50),   # Kab. Klungkung
    "bali-tabanan": Region("bali", -8.65, 115.00, -8.35, 115.18),     # Kab. Tabanan
    "bali-bangli": Region("bali", -8.50, 115.30, -8.25, 115.50),      # Kab. Bangli (central highlands)
    "bali-jembrana": Region("bali", -8.50, 114.43, -8.20, 114.85),    # Kab. Jembrana (west Bali)
    # --- Jawa (urban metro areas) ---
    "jakarta": Region("jakarta", -6.30, 106.75, -6.10, 106.95),
    "bandung": Region("bandung", -6.95, 107.57, -6.87, 107.67),
    "surabaya": Region("surabaya", -7.33, 112.70, -7.23, 112.80),
    "semarang": Region("semarang", -7.02, 110.37, -6.94, 110.47),
    "yogyakarta": Region("yogyakarta", -7.82, 110.34, -7.74, 110.42),
    "solo": Region("solo", -7.60, 110.79, -7.53, 110.86),
    "malang": Region("malang", -8.00, 112.60, -7.94, 112.66),
    # --- Sulawesi (province-level, entire island) ---
    "sulsel": Region("sulsel", -5.60, 119.25, -2.80, 120.65),      # Sulawesi Selatan
    "sulbar": Region("sulbar", -3.60, 118.70, -1.40, 119.45),      # Sulawesi Barat
    "sulteng": Region("sulteng", -2.10, 119.60, 0.90, 123.40),     # Sulawesi Tengah
    "gorontalo": Region("gorontalo", 0.20, 121.80, 0.95, 123.15),  # Gorontalo province
    "sulut": Region("sulut", 0.30, 123.20, 1.65, 125.30),          # Sulawesi Utara
    "sultra": Region("sultra", -5.55, 121.30, -3.00, 124.10),      # Sulawesi Tenggara
}

# ============================================================
# TRAFFIC HEURISTIC (OSM highway class → vehicles/hour)
# Based on IVT/COPERT adapted for Indonesian road conditions
# ============================================================

TRAFFIC_BASE_ESTIMATE: dict[str, int] = {
    "motorway": 2000,
    "motorway_link": 1500,
    "trunk": 1500,
    "trunk_link": 1200,
    "primary": 1000,
    "primary_link": 800,
    "secondary": 600,
    "secondary_link": 500,
    "tertiary": 300,
    "tertiary_link": 250,
    "unclassified": 150,
    "residential": 100,
    "living_street": 50,
    "service": 30,
    "pedestrian": 5,
    "track": 10,
    "path": 0,
    "footway": 0,
    "cycleway": 0,
    "steps": 0,
}

# Road width estimates (meters) when OSM `width` tag is missing
LANE_WIDTH_M = 3.5
DEFAULT_ROAD_WIDTH: dict[str, float] = {
    "motorway": 14.0,
    "trunk": 10.5,
    "primary": 7.0,
    "secondary": 7.0,
    "tertiary": 5.5,
    "residential": 4.0,
    "living_street": 3.5,
    "service": 3.0,
    "path": 1.5,
    "footway": 1.5,
}

# Highway classes to include (skip very minor paths for storage)
INCLUDED_HIGHWAY_CLASSES = {
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
}

OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT = 180  # seconds

# ============================================================
# OVERPASS QUERIES
# ============================================================

def build_road_query(region: Region) -> str:
    """Build Overpass QL query for roads in a bounding box."""
    bbox = f"{region.south},{region.west},{region.north},{region.east}"
    highway_filter = "|".join(INCLUDED_HIGHWAY_CLASSES)
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];
(
  way["highway"~"^({highway_filter})$"]({bbox});
);
out body;
>;
out skel qt;
"""


def build_landuse_query(region: Region) -> str:
    """Build Overpass QL query for landuse/natural areas in a bounding box."""
    bbox = f"{region.south},{region.west},{region.north},{region.east}"
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}][maxsize:536870912];
(
  way["landuse"]({bbox});
  way["natural"~"wood|tree_row|grassland|wetland|water"]({bbox});
  way["leisure"~"park|garden"]({bbox});
);
out body;
>;
out skel qt;
"""


def build_building_query(region: Region) -> str:
    """Build Overpass QL query for buildings (for canyon ratio)."""
    bbox = f"{region.south},{region.west},{region.north},{region.east}"
    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}][maxsize:536870912];
(
  way["building"]({bbox});
);
out body;
>;
out skel qt;
"""


# ============================================================
# OVERPASS API CALLER
# ============================================================

def query_overpass(query: str, label: str = "") -> dict:
    """Send query to Overpass API with retry logic."""
    for attempt in range(3):
        try:
            log.info(f"Querying Overpass{f' ({label})' if label else ''} (attempt {attempt + 1})...")
            resp = requests.post(
                OVERPASS_API_URL,
                data={"data": query},
                timeout=OVERPASS_TIMEOUT + 30,
            )
            resp.raise_for_status()
            data = resp.json()
            element_count = len(data.get("elements", []))
            log.info(f"  → {element_count} elements received")
            return data
        except requests.exceptions.HTTPError:
            if resp.status_code == 504:
                # Server timeout → area probably too large, fail fast for adaptive split
                if attempt == 0:
                    log.warning(f"  Overpass timeout (504), retrying once...")
                    time.sleep(10)
                    continue
                raise RuntimeError(f"Overpass 504 timeout ({label})")
            elif resp.status_code == 429:
                wait = 30 * (attempt + 1)
                log.warning(f"  Rate limited (429), waiting {wait}s...")
                time.sleep(wait)
            else:
                raise
        except requests.exceptions.ReadTimeout:
            if attempt == 0:
                log.warning(f"  Read timeout, retrying once...")
                time.sleep(10)
                continue
            raise RuntimeError(f"Overpass read timeout ({label})")
    raise RuntimeError(f"Overpass query failed after 3 attempts ({label})")


def query_overpass_adaptive(
    query_builder, region: Region, label: str, min_deg: float = 0.05, depth: int = 0
) -> dict:
    """Query Overpass with adaptive tiling.

    Tries the full bbox first. If the query fails (504 timeout = area too large),
    splits into 4 sub-tiles and recurses. Ocean/empty tiles resolve in one call;
    only dense areas get split. Much faster than pre-computed fixed grids.
    """
    try:
        return query_overpass(query_builder(region), label)
    except RuntimeError as e:
        dlat = region.north - region.south
        dlon = region.east - region.west
        if dlat < min_deg and dlon < min_deg:
            log.warning(f"  Tile too small to split ({label}), returning empty")
            return {"elements": []}

        mid_lat = region.south + dlat / 2
        mid_lon = region.west + dlon / 2
        indent = "  " * (depth + 1)
        log.info(f"{indent}Splitting {label} into 4 sub-tiles (depth={depth+1})...")

        sub_tiles = [
            Region(region.name, region.south, region.west, mid_lat, mid_lon),
            Region(region.name, region.south, mid_lon, mid_lat, region.east),
            Region(region.name, mid_lat, region.west, region.north, mid_lon),
            Region(region.name, mid_lat, mid_lon, region.north, region.east),
        ]

        all_elements: list[dict] = []
        seen_ids: set[int] = set()
        for i, tile in enumerate(sub_tiles):
            if i > 0:
                time.sleep(5)
            tile_label = f"{label}[{i+1}/4]"
            tile_data = query_overpass_adaptive(
                query_builder, tile, tile_label, min_deg, depth + 1
            )
            for elem in tile_data.get("elements", []):
                eid = elem.get("id", id(elem))
                if eid not in seen_ids:
                    seen_ids.add(eid)
                    all_elements.append(elem)
        if depth == 0:
            log.info(f"  Merged {len(all_elements)} unique elements (adaptive)")
        return {"elements": all_elements}


# ============================================================
# GEOMETRY HELPERS
# ============================================================

def build_node_index(elements: list[dict]) -> dict[int, tuple[float, float]]:
    """Build node ID → (lon, lat) lookup from Overpass elements."""
    return {
        e["id"]: (e["lon"], e["lat"])
        for e in elements
        if e["type"] == "node" and "lon" in e and "lat" in e
    }


def way_to_linestring(way: dict, nodes: dict[int, tuple[float, float]]) -> LineString | None:
    """Convert an OSM way to a Shapely LineString."""
    coords = []
    for nid in way.get("nodes", []):
        if nid in nodes:
            coords.append(nodes[nid])
    if len(coords) < 2:
        return None
    return LineString(coords)


def way_to_centroid(way: dict, nodes: dict[int, tuple[float, float]]) -> Point | None:
    """Get centroid of an OSM way as a Point."""
    ls = way_to_linestring(way, nodes)
    if ls is None:
        return None
    return ls.centroid


# ============================================================
# DATA ENRICHMENT
# ============================================================

def estimate_road_width(tags: dict) -> float:
    """Estimate road width from OSM tags."""
    # Try explicit width tag
    width_str = tags.get("width", "")
    if width_str:
        try:
            return float(width_str.replace(" m", "").replace("m", "").strip())
        except ValueError:
            pass

    # Estimate from lanes
    lanes_str = tags.get("lanes", "")
    if lanes_str:
        try:
            return int(lanes_str) * LANE_WIDTH_M
        except ValueError:
            pass

    # Fallback by highway class
    highway = tags.get("highway", "residential")
    base = highway.replace("_link", "")
    return DEFAULT_ROAD_WIDTH.get(base, DEFAULT_ROAD_WIDTH.get(highway, 4.0))


def get_traffic_estimate(tags: dict) -> int:
    """Estimate base traffic volume from OSM highway classification."""
    highway = tags.get("highway", "")
    base = TRAFFIC_BASE_ESTIMATE.get(highway, 50)

    # Adjust for lanes (more lanes = more capacity)
    lanes_str = tags.get("lanes", "")
    if lanes_str:
        try:
            lanes = int(lanes_str)
            if lanes > 2:
                base = int(base * (lanes / 2) * 0.8)  # diminishing returns
        except ValueError:
            pass

    return base


def find_nearest_landuse(
    road_centroid: Point,
    landuse_rtree,
    landuse_data: list[tuple[Point, str]],
    max_dist_deg: float = 0.0005,  # ~55m at equator
) -> str | None:
    """Find the nearest landuse tag within a distance threshold using R-tree."""
    if not landuse_data:
        return None
    x, y = road_centroid.x, road_centroid.y
    candidates = list(landuse_rtree.nearest((x, y, x, y), 1))
    if not candidates:
        return None
    idx = candidates[0]
    lu_centroid, lu_tag = landuse_data[idx]
    if road_centroid.distance(lu_centroid) < max_dist_deg:
        return lu_tag
    return None


def estimate_canyon_ratio(
    road_geom: LineString,
    road_width: float,
    building_rtree,
    building_data: list[tuple[Point, float]],
    buffer_deg: float = 0.0003,  # ~33m
) -> float | None:
    """Estimate canyon ratio from nearby buildings using R-tree."""
    if not building_data:
        return None
    centroid = road_geom.centroid
    x, y = centroid.x, centroid.y
    bbox = (x - buffer_deg, y - buffer_deg, x + buffer_deg, y + buffer_deg)
    candidate_ids = list(building_rtree.intersection(bbox))
    if not candidate_ids:
        return None
    nearby_heights = [building_data[i][1] for i in candidate_ids]
    avg_height = sum(nearby_heights) / len(nearby_heights)
    if road_width <= 0:
        return None
    ratio = round(avg_height / road_width, 2)
    return min(ratio, 99.99)  # cap for DECIMAL(4,2)


def extract_building_height(tags: dict) -> float:
    """Extract building height from OSM tags."""
    # Explicit height
    h = tags.get("height", "")
    if h:
        try:
            return float(h.replace(" m", "").replace("m", "").strip())
        except ValueError:
            pass
    # Estimate from levels
    levels = tags.get("building:levels", "")
    if levels:
        try:
            return float(levels) * 3.5
        except ValueError:
            pass
    # Default for Indonesia
    return 5.0


def extract_landuse_tag(tags: dict) -> str:
    """Extract the primary landuse category from OSM tags."""
    for key in ("landuse", "natural", "leisure"):
        if key in tags:
            return tags[key]
    return "unknown"


# ============================================================
# MAIN PROCESSING
# ============================================================

def process_region(region: Region, api_base: str = "", api_headers: dict = None, dry_run: bool = False) -> int:
    """Process a single region: query Overpass → enrich → UPSERT to DB."""
    log.info(f"{'[DRY RUN] ' if dry_run else ''}Processing region: {region.name}")
    log.info(f"  Bounding box: S={region.south:7.2f} W={region.west:7.2f} N={region.north:7.2f} E={region.east:7.2f}")

    # 1. Query roads (adaptive tiling for large regions)
    road_data = query_overpass_adaptive(build_road_query, region, f"{region.name} roads")
    road_elements = road_data.get("elements", [])
    nodes = build_node_index(road_elements)
    ways = [e for e in road_elements if e["type"] == "way"]
    log.info(f"  Found {len(ways)} road ways, {len(nodes)} nodes")

    if not ways:
        log.warning(f"  No roads found for {region.name}, skipping.")
        return 0

    # 2. Query landuse (with delay to be polite to Overpass) — optional enrichment
    time.sleep(5)
    landuse_list: list[tuple[Point, str]] = []
    lu_idx = rtree_index.Index()
    try:
        landuse_data = query_overpass_adaptive(build_landuse_query, region, f"{region.name} landuse")
        landuse_elements = landuse_data.get("elements", [])
        landuse_nodes = build_node_index(landuse_elements)
        landuse_ways = [e for e in landuse_elements if e["type"] == "way" and "tags" in e]

        # Build landuse R-tree spatial index
        for i, lw in enumerate(landuse_ways):
            c = way_to_centroid(lw, landuse_nodes)
            if c:
                landuse_list.append((c, extract_landuse_tag(lw.get("tags", {}))))
                lu_idx.insert(len(landuse_list) - 1, (c.x, c.y, c.x, c.y))
        log.info(f"  Landuse index: {len(landuse_list)} areas")
    except Exception as e:
        log.warning(f"  Landuse query failed ({e}), using defaults")

    # 3. Query buildings (for canyon ratio) — optional enrichment
    time.sleep(5)
    building_list: list[tuple[Point, float]] = []
    bldg_idx = rtree_index.Index()
    try:
        building_data = query_overpass_adaptive(build_building_query, region, f"{region.name} buildings")
        building_elements = building_data.get("elements", [])
        building_nodes = build_node_index(building_elements)
        building_ways = [e for e in building_elements if e["type"] == "way" and "tags" in e]

        # Build building R-tree spatial index (centroid → height)
        for i, bw in enumerate(building_ways):
            c = way_to_centroid(bw, building_nodes)
            if c:
                h = extract_building_height(bw.get("tags", {}))
                building_list.append((c, h))
                bldg_idx.insert(len(building_list) - 1, (c.x, c.y, c.x, c.y))
        log.info(f"  Building index: {len(building_list)} buildings")
    except Exception as e:
        log.warning(f"  Building query failed ({e}), using default canyon ratios")

    # 4. Process each road way
    rows = []
    skipped = 0
    for way in ways:
        tags = way.get("tags", {})
        highway = tags.get("highway", "")

        # Skip if not in our included classes
        if highway not in INCLUDED_HIGHWAY_CLASSES:
            skipped += 1
            continue

        geom = way_to_linestring(way, nodes)
        if geom is None:
            skipped += 1
            continue

        road_width = min(estimate_road_width(tags), 999.99)  # cap for DECIMAL(5,2)
        centroid = geom.centroid

        # Landuse lookup
        landuse = find_nearest_landuse(centroid, lu_idx, landuse_list)

        # Canyon ratio
        canyon = estimate_canyon_ratio(geom, road_width, bldg_idx, building_list)

        # Parse maxspeed
        maxspeed = None
        ms_str = tags.get("maxspeed", "")
        if ms_str:
            try:
                maxspeed = int(ms_str.replace(" km/h", "").replace("km/h", "").strip())
            except ValueError:
                pass

        # Parse lanes
        lanes = None
        lanes_str = tags.get("lanes", "")
        if lanes_str:
            try:
                lanes = int(lanes_str)
            except ValueError:
                pass

        # Build GeoJSON geometry
        geojson = json.dumps({
            "type": "LineString",
            "coordinates": list(geom.coords),
        })

        rows.append({
            "osm_way_id": way["id"],
            "geom": geojson,
            "highway": highway[:30] if highway else highway,
            "lanes": lanes,
            "width": road_width,
            "surface": (tags.get("surface") or "")[:30] or None,
            "maxspeed": maxspeed,
            "name": tags.get("name"),
            "landuse_proxy": landuse[:30] if landuse else landuse,
            "canyon_ratio": canyon,
            "elevation_avg": None,  # needs DEM, skip for now
            "traffic_base_estimate": get_traffic_estimate(tags),
            "region": region.name,
        })

    log.info(f"  Prepared {len(rows)} rows ({skipped} skipped)")

    if dry_run:
        log.info(f"  [DRY RUN] Would UPSERT {len(rows)} rows to road_segments")
        if rows:
            sample = rows[0]
            log.info(f"  Sample: osm_way_id={sample['osm_way_id']}, highway={sample['highway']}, "
                     f"lanes={sample['lanes']}, width={sample['width']}, landuse={sample['landuse_proxy']}, "
                     f"canyon={sample['canyon_ratio']}, traffic={sample['traffic_base_estimate']}")
        return len(rows)

    # 5. UPSERT to Supabase via REST API
    if not rows:
        return 0

    BATCH_SIZE = 200  # PostgREST handles smaller batches better
    total_upserted = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        resp = requests.post(
            f"{api_base}/road_segments?on_conflict=osm_way_id",
            headers={**api_headers, "Prefer": "resolution=merge-duplicates"},
            json=batch,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            log.error(f"  UPSERT failed (batch {i//BATCH_SIZE}): {resp.status_code} {resp.text[:300]}")
            continue
        total_upserted += len(batch)
        log.info(f"  UPSERTed {total_upserted}/{len(rows)}...")

    log.info(f"  ✅ {region.name}: {total_upserted} road segments UPSERTed")
    return total_upserted


def get_supabase_api():
    """Get Supabase REST API base URL and headers from environment variables."""
    supabase_url = os.environ.get("SUPABASE_URL", os.environ.get("VITE_SUPABASE_URL", ""))
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        log.error("Set them as environment variables or in a .env file")
        sys.exit(1)

    api_base = f"{supabase_url}/rest/v1"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    return api_base, headers


def verify_counts(api_base: str, api_headers: dict, regions: list[str]):
    """Print region counts from road_segments table via REST API."""
    log.info("=" * 50)
    log.info("Road segments per region:")
    total = 0
    for region_name in sorted(REGIONS.keys()):
        resp = requests.get(
            f"{api_base}/road_segments?select=id&region=eq.{region_name}",
            headers={**api_headers, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
            timeout=30,
        )
        # Content-Range header: "0-0/6560" or "*/0"
        content_range = resp.headers.get("Content-Range", "*/0")
        count = int(content_range.split("/")[-1])
        marker = "✅" if region_name in regions else "  "
        if count > 0:
            log.info(f"  {marker} {region_name}: {count:,}")
            total += count
    log.info(f"  TOTAL: {total:,}")
    log.info("=" * 50)


def main():
    parser = argparse.ArgumentParser(description="VAYU OSM Road Segment Processor")
    parser.add_argument("--region", type=str, help=f"Region to process: {', '.join(REGIONS.keys())}")
    parser.add_argument("--all", action="store_true", help="Process all regions")
    parser.add_argument("--dry-run", action="store_true", help="Query Overpass but don't write to DB")
    parser.add_argument("--list", action="store_true", help="List available regions")
    args = parser.parse_args()

    if args.list:
        print("Available regions:")
        for name, r in REGIONS.items():
            dlat = r.north - r.south
            dlon = r.east - r.west
            lat_mid = (r.north + r.south) / 2
            area = dlat * dlon * 111.0 * 111.0 * math.cos(math.radians(lat_mid))
            print(f"  {name:15s}  S:{r.south:7.2f} W:{r.west:7.2f} N:{r.north:7.2f} E:{r.east:7.2f}  ~{area:,.0f} km²")
        return

    if not args.region and not args.all:
        parser.error("Specify --region <name> or --all")

    regions_to_process = list(REGIONS.keys()) if args.all else [args.region]

    # Validate region names
    for r in regions_to_process:
        if r not in REGIONS:
            parser.error(f"Unknown region: {r}. Use --list to see available regions.")

    # Connect to Supabase REST API
    api_base = ""
    api_headers = {}
    if not args.dry_run:
        api_base, api_headers = get_supabase_api()
        log.info("Using Supabase REST API for UPSERT")

    # Process each region
    grand_total = 0
    for region_name in regions_to_process:
        region = REGIONS[region_name]
        try:
            count = process_region(region, api_base, api_headers, dry_run=args.dry_run)
            grand_total += count
        except Exception as e:
            log.error(f"Failed to process {region_name}: {e}")
            continue

        # Be polite to Overpass between regions
        if region_name != regions_to_process[-1]:
            log.info("Waiting 10s before next region...")
            time.sleep(10)

    log.info(f"\n{'='*50}")
    log.info(f"DONE — {grand_total:,} total road segments across {len(regions_to_process)} region(s)")

    # Verify counts
    if not args.dry_run:
        verify_counts(api_base, api_headers, regions_to_process)


if __name__ == "__main__":
    main()
