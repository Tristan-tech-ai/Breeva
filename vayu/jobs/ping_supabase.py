"""
VAYU Engine — Supabase Keep-Alive Ping
========================================
Prevents Supabase free-tier from pausing after 1 week of inactivity.
Invoked by GitHub Actions ``vayu-ping.yml`` (every 6 days).

ERD Section 11.4 — Degradation Matrix
"""

from __future__ import annotations

import logging
import os
import sys

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ping_supabase")


def main():
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

    # Simple SELECT 1 equivalent — count rows in aqi_grid
    try:
        resp = requests.get(
            f"{api_base}/aqi_grid",
            headers={**headers, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
            params={"select": "tile_id"},
            timeout=15,
        )
        content_range = resp.headers.get("Content-Range", "*/0")
        count = content_range.split("/")[-1]
        log.info("✅ Supabase alive — aqi_grid rows: %s (status %d)", count, resp.status_code)
    except Exception as exc:
        log.error("❌ Supabase ping failed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
