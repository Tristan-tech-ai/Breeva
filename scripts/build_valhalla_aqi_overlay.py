"""Build the per-edge AQI penalty overlay for Valhalla-C (the AQI-cost fork).

  road_aqi_precomputed (osm_way_id -> aqi)  JOIN  way_edges.txt (osm_way_id -> Valhalla GraphIds)
    -> edge_aqi.bin : [uint64 count][ (uint64 graphid, float32 penalty) ... ]  sorted by graphid.

The forked sif::EdgeCost loads this once at startup and applies, per edge:
    factor *= (1 + aqi_weight * penalty[graphid])      # `secs` (ETA) left UNCHANGED -> honest time

penalty = ood_refused ? 0 : max(0, (aqi - BASELINE) / SCALE)
  AQI 50 -> 0 (clean, no avoidance) · AQI 100 -> 1 · AQI 150 -> 2 · AQI 200 -> 3
Edges with no AQI row (or penalty 0) get NO entry -> the fork defaults them to 0.

Run on the rig (reads D:\breeva-valhalla via the local FS, writes into the Valhalla /custom_files mount):
    python scripts/build_valhalla_aqi_overlay.py
Hourly refresh later: re-run + SIGHUP/restart valhalla_service to reload (per-hour penalties = v2 via aqi_routing_weights).
"""
from __future__ import annotations

import os
import struct
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env.local")
POOLER = os.environ["SUPABASE_POOLER_URL"]

WAY_EDGES = Path(r"D:\breeva-valhalla\valhalla_tiles\way_edges.txt")
OUT = Path(r"D:\breeva-valhalla\valhalla_tiles\edge_aqi.bin")

BASELINE = 50.0   # AQI at/below this = clean = no penalty (WHO "good" boundary)
SCALE = 50.0      # AQI units per +1.0 penalty


def log(m: str) -> None:
    print(m, flush=True)


def main() -> None:
    t0 = time.time()

    # 1. road AQI -> penalty per osm_way_id (server-side cursor; ~1.4M rows stream low-memory)
    log("loading road_aqi_precomputed ...")
    conn = psycopg2.connect(POOLER, connect_timeout=30)
    way_pen: dict[int, float] = {}
    with conn.cursor(name="aqi_overlay_cur") as cur:
        cur.itersize = 50000
        cur.execute(
            "SELECT osm_way_id, aqi, COALESCE(ood_refused, false) "
            "FROM public.road_aqi_precomputed WHERE aqi IS NOT NULL AND osm_way_id IS NOT NULL"
        )
        for wid, aqi, ood in cur:
            pen = 0.0 if ood else max(0.0, (float(aqi) - BASELINE) / SCALE)
            if pen > 0.0:
                way_pen[int(wid)] = pen
    conn.close()
    log(f"  {len(way_pen):,} ways with a positive AQI penalty")

    # 2. stream way_edges.txt -> per-directed-edge (graphid, penalty)
    log("joining way_edges.txt ...")
    edges: list[tuple[int, float]] = []
    penalized_ways = 0
    with open(WAY_EDGES) as f:
        for line in f:
            parts = line.rstrip("\n").split(",")
            if len(parts) < 3:
                continue
            pen = way_pen.get(int(parts[0]))
            if pen is None:
                continue
            # pairs of (dir, graphid) after the osm_way_id
            for i in range(1, len(parts) - 1, 2):
                edges.append((int(parts[i + 1]), pen))
            penalized_ways += 1
    log(f"  {penalized_ways:,} penalized ways -> {len(edges):,} directed edges")

    # 3. sort by graphid + write binary (the fork bsearches this)
    edges.sort(key=lambda e: e[0])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "wb") as out:
        out.write(struct.pack("<Q", len(edges)))
        packer = struct.Struct("<Qf")
        for gid, pen in edges:
            out.write(packer.pack(gid, pen))
    log(f"done: {len(edges):,} edges, {OUT.stat().st_size / 1e6:.1f} MB -> {OUT}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
