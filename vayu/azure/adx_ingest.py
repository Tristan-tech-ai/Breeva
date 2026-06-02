"""Ingest breeva per-road AQI (Supabase road_aqi_precomputed) -> Azure Data Explorer FREE cluster
breeva_db.road_aqi. The $0 spatiotemporal-AQI centerpiece (KQL geospatial + anomaly).

Auth: az CLI (the logged-in principal is granted Database Admin on breeva_db) — NO secret, NO app
registration, NO subscription cost (ADX free cluster is a separate $0 entity).

Run (PATH must include the az wbin; the script also appends it):
    vayu/.venv/Scripts/python.exe vayu/azure/adx_ingest.py
"""
from __future__ import annotations
import os, sys, time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# az-cli-auth shells out to `az`; ensure the CLI is on PATH for this process.
os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"

import psycopg2
import pandas as pd
from dotenv import load_dotenv
from azure.kusto.data import KustoConnectionStringBuilder, KustoClient
from azure.kusto.data.data_format import DataFormat
from azure.kusto.ingest import QueuedIngestClient, IngestionProperties

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")
POOLER = os.environ["SUPABASE_POOLER_URL"]

CLUSTER = "https://kvc-c00cjha46ak8x8mp05.australiaeast.kusto.windows.net"
INGEST = "https://ingest-kvc-c00cjha46ak8x8mp05.australiaeast.kusto.windows.net"
DB = "breeva_db"
TABLE = "road_aqi"

DDL = (
    ".create-merge table road_aqi (osm_way_id:long, region:string, highway:string, ts:datetime, "
    "lon:real, lat:real, aqi:int, pm25:real, no2:real, pm25_delta:real, no2_delta:real, "
    "pm10_delta:real, confidence:string)"
)

# Column order MUST match the table schema (ingest_from_dataframe maps positionally).
SQL = """
SELECT osm_way_id,
       region,
       COALESCE(highway, '')                       AS highway,
       computed_at                                 AS ts,
       ST_X(ST_Centroid(geom))::real               AS lon,
       ST_Y(ST_Centroid(geom))::real               AS lat,
       aqi, pm25, no2, pm25_delta, no2_delta, pm10_delta,
       COALESCE(confidence, '')                    AS confidence
FROM public.road_aqi_precomputed
WHERE geom IS NOT NULL AND osm_way_id IS NOT NULL
"""


def log(m: str) -> None:
    print(m, flush=True)


def main() -> None:
    t0 = time.time()
    client = KustoClient(KustoConnectionStringBuilder.with_az_cli_authentication(CLUSTER))
    client.execute(DB, DDL)
    log("schema ready")

    log("pulling per-road AQI from Supabase (PostGIS centroids) ...")
    conn = psycopg2.connect(POOLER, connect_timeout=30)
    df = pd.read_sql(SQL, conn)
    conn.close()
    log(f"  {len(df):,} rows pulled ({time.time() - t0:.0f}s)")

    iclient = QueuedIngestClient(KustoConnectionStringBuilder.with_az_cli_authentication(INGEST))
    props = IngestionProperties(database=DB, table=TABLE, data_format=DataFormat.CSV)
    iclient.ingest_from_dataframe(df, ingestion_properties=props)
    log(f"  queued {len(df):,} rows -> {DB}.{TABLE} (queued ingestion batches over ~minutes)")

    target = int(len(df) * 0.99)
    for i in range(24):
        time.sleep(15)
        n = list(client.execute(DB, f"{TABLE} | count").primary_results[0])[0]["Count"]
        log(f"  [{(i + 1) * 15:>3}s] {TABLE} count = {n:,}")
        if n >= target:
            break
    log(f"done ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
