"""
VAYU Engine — Parquet History Export
=====================================
Weekly export of ``aqi_grid`` snapshot to Parquet format for ML training.
Stored in ``vayu/exports/`` directory (gitignored) or Supabase Storage.

ERD Section 11.4 — History data for ML pipeline.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("export_parquet")

EXPORT_DIR = Path(__file__).parent.parent / "exports"


def fetch_all_tiles() -> list[dict]:
    """Fetch all aqi_grid rows from Supabase."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    api_base = f"{url}/rest/v1"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    all_rows: list[dict] = []
    offset = 0
    batch_size = 1000

    while True:
        resp = requests.get(
            f"{api_base}/aqi_grid",
            headers=headers,
            params={
                "select": "tile_id,lat,lon,aqi,pm25,pm10,no2,co,o3,"
                          "confidence,layer_source,region,valid_until,"
                          "hit_count,created_at,updated_at",
                "order": "tile_id",
                "offset": str(offset),
                "limit": str(batch_size),
            },
            timeout=30,
        )
        if resp.status_code != 200:
            log.error("Fetch failed at offset %d: %s", offset, resp.status_code)
            break
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += len(rows)
        if len(rows) < batch_size:
            break

    return all_rows


def export_to_parquet(rows: list[dict], output_path: Path) -> None:
    """Convert rows to a Parquet file using PyArrow."""
    import pandas as pd

    df = pd.DataFrame(rows)
    df.to_parquet(output_path, engine="pyarrow", compression="snappy", index=False)
    size_mb = output_path.stat().st_size / (1024 * 1024)
    log.info("  Written: %s (%.2f MB, %d rows)", output_path.name, size_mb, len(df))


def main():
    log.info("📦 VAYU Parquet Export")

    # Ensure export directory exists
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    # Fetch data
    rows = fetch_all_tiles()
    if not rows:
        log.info("  No data to export.")
        return

    log.info("  Fetched %d tiles", len(rows))

    # Generate filename with timestamp
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_path = EXPORT_DIR / f"aqi_grid_{ts}.parquet"

    # Export
    export_to_parquet(rows, output_path)
    log.info("✅ Export complete: %s", output_path)


if __name__ == "__main__":
    main()
