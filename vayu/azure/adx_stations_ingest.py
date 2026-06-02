"""Ingest the REAL monitoring-station network (Supabase station_snapshots) -> ADX breeva_db.stations.
Just the distinct ACTIVE stations (latest loc per station_uid, last 30d) — ~178 rows. Powers the
"monitoring-desert" fairness analysis: distance from every road to the nearest real sensor.

az-cli auth, $0. Run:  vayu/.venv/Scripts/python.exe vayu/azure/adx_stations_ingest.py
"""
from __future__ import annotations
import os, sys, time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

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
TABLE = "stations"

DDL = (".create-merge table stations (station_uid:string, source:string, region:string, "
       "lon:real, lat:real, pm25:real, ts:datetime)")

SQL = """
SELECT DISTINCT ON (station_uid)
       station_uid, source, region,
       ST_X(loc)::real AS lon, ST_Y(loc)::real AS lat, pm25, measured_at AS ts
FROM public.station_snapshots
WHERE loc IS NOT NULL AND measured_at > now() - interval '30 days'
ORDER BY station_uid, measured_at DESC
"""


def main() -> None:
    t0 = time.time()
    client = KustoClient(KustoConnectionStringBuilder.with_az_cli_authentication(CLUSTER))
    client.execute(DB, ".drop table stations ifexists")
    client.execute(DB, DDL)
    print("schema ready", flush=True)

    conn = psycopg2.connect(POOLER, connect_timeout=30)
    df = pd.read_sql(SQL, conn)
    conn.close()
    print(f"  {len(df):,} active stations pulled ({time.time()-t0:.0f}s)", flush=True)

    iclient = QueuedIngestClient(KustoConnectionStringBuilder.with_az_cli_authentication(INGEST))
    # flush_immediately: the table is tiny (~178 rows) — skip the default ~5-min batch window.
    props = IngestionProperties(database=DB, table=TABLE, data_format=DataFormat.CSV, flush_immediately=True)
    iclient.ingest_from_dataframe(df, ingestion_properties=props)
    print(f"  queued {len(df):,} -> {DB}.{TABLE} (flush_immediately)", flush=True)

    for i in range(20):
        time.sleep(15)
        n = list(client.execute(DB, f"{TABLE} | count").primary_results[0])[0]["Count"]
        print(f"  [{(i+1)*15:>3}s] {TABLE} count = {n:,}", flush=True)
        if n >= len(df):
            break
    print(f"done ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
