"""Build the per-edge AQI penalty overlay for Valhalla-C (the AQI-cost fork).

  road_aqi_precomputed (osm_way_id -> aqi)  JOIN  way_edges.txt (osm_way_id -> Valhalla GraphIds)
    -> edge_aqi.bin : [uint64 count][ (uint64 graphid, float32 penalty) ... ]  sorted by graphid.

The forked sif::EdgeCost loads this once at startup and applies, per edge:
    factor *= (1 + aqi_weight * penalty[graphid])      # `secs` (ETA) left UNCHANGED -> honest time

penalty = TRAP (traffic-related air pollution), NO2-dominant + capped + per-highway-class floor:
  min(3, 0.70*no2_delta/50 + 0.20*pm25_delta/5 + 0.10*pm10_delta/10) then max(., CLASS_FLOOR[highway]).
  ood_refused -> 0; edges below TRAP_MIN (or with no row) get NO entry -> the fork defaults them to 0.
  Weights MUST MATCH the TS side (api/vayu/route-score.ts + src/lib/exposure.ts); parity test:
  scripts/test_trap_parity.mjs. Ambient PM2.5 is flat; the routable signal is the NO2 traffic increment.

Run on the rig (reads D:\breeva-valhalla via the local FS, writes into the Valhalla /custom_files mount):
    python scripts/build_valhalla_aqi_overlay.py
Refresh: re-run, then `docker restart valhalla_c_prod` — the overlay is a LOAD-ONCE singleton
(no SIGHUP reload), so the running fork keeps the old overlay until the process restarts.
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

# Per-edge ROUTING penalty = TRAP (traffic-related air pollution), NO2-dominant. Ambient PM2.5 is
# background-dominated (~33.6 ug everywhere, flat) -> useless for routing; the avoidable, routable
# signal is the traffic increment, and NO2 has the steep near-road gradient (~30x swing by road class:
# living_street ~7.6 vs motorway ~226 ug/m3 no2_delta). pm25/pm10 deltas are weak co-signals.
TRAP_W_NO2, TRAP_W_PM25, TRAP_W_PM10 = 0.70, 0.20, 0.10
TRAP_S_NO2, TRAP_S_PM25, TRAP_S_PM10 = 50.0, 5.0, 10.0   # ug/m3 per +1.0 penalty
TRAP_CAP = 3.0      # bound the A* cost multiplier (1 + aqi_weight * penalty)
TRAP_MIN = 0.05     # skip near-zero (kampung) roads -> no entry -> fork routes freely on them
# Per-highway-class floor: robustness prior so arterials always carry signal even if a segment's
# modeled delta is anomalously low. residential/service/living_street get no floor (freely routable).
TRAP_CLASS_FLOOR = {
    "motorway": 2.5, "motorway_link": 2.5, "trunk": 2.0, "trunk_link": 2.0,
    "primary": 1.2, "primary_link": 1.2, "secondary": 0.6, "secondary_link": 0.6,
    "tertiary": 0.3, "tertiary_link": 0.3,
}


def trap_penalty(no2_delta: float, pm25_delta: float, pm10_delta: float, highway: str | None) -> float:
    """Capped, NO2-dominant traffic penalty + per-class floor. MUST MATCH the weights in
    api/vayu/route-score.ts trapConcentration + src/lib/exposure.ts (scripts/test_trap_parity.mjs)."""
    p = (TRAP_W_NO2 * max(0.0, no2_delta) / TRAP_S_NO2
         + TRAP_W_PM25 * max(0.0, pm25_delta) / TRAP_S_PM25
         + TRAP_W_PM10 * max(0.0, pm10_delta) / TRAP_S_PM10)
    return max(min(TRAP_CAP, p), TRAP_CLASS_FLOOR.get(highway or "", 0.0))


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
            "SELECT osm_way_id, no2_delta, pm25_delta, pm10_delta, COALESCE(ood_refused, false), highway "
            "FROM public.road_aqi_precomputed WHERE no2_delta IS NOT NULL AND osm_way_id IS NOT NULL"
        )
        for wid, no2d, pm25d, pm10d, ood, highway in cur:
            if ood:
                continue  # ood_refused -> no entry -> fork defaults to 0
            pen = trap_penalty(float(no2d or 0.0), float(pm25d or 0.0), float(pm10d or 0.0), highway)
            if pen < TRAP_MIN:
                continue  # near-zero (kampung) road -> fork routes freely
            way_pen[int(wid)] = pen
    conn.close()
    log(f"  {len(way_pen):,} ways with a TRAP penalty (NO2-dominant)")

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
    log("  REMINDER: `docker restart valhalla_c_prod` — overlay is load-once; the fork keeps the old one until restart.")


if __name__ == "__main__":
    main()
