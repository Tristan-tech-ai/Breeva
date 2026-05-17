"""
Tier 3 Phase 3.0b — WAQI / IQAir station poller.

Fetches all WAQI stations inside each region bbox + IQAir nearest_city
fallback, converts AQI-US → PM2.5 (EPA inverse breakpoints), upserts to
public.station_snapshots. Run hourly via Windows Task Scheduler.

Then calls public.attach_station_ground_truth() to backfill
prediction_logs.ground_truth_pm25 from any matching snapshots
(spatial ≤2km, temporal ≤2h).

Run:
    python vayu/jobs/snapshot_stations.py
    python vayu/jobs/snapshot_stations.py --region jakarta
    python vayu/jobs/snapshot_stations.py --no-attach   # poll only
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('snapshot_stations')

# Region bboxes (S, W, N, E) — mirror process_osm.py REGIONS but flat list
REGION_BBOXES: dict[str, tuple[float, float, float, float]] = {
    'jakarta':    (-6.30, 106.75, -6.10, 106.95),
    'bali':       (-8.85, 115.00, -8.20, 115.72),  # widened: Badung+Gianyar+Karangasem+Tabanan
    'bandung':    (-6.95, 107.57, -6.87, 107.67),
    'surabaya':   (-7.33, 112.70, -7.23, 112.80),
    'semarang':   (-7.10, 110.30, -6.90, 110.55),
    'yogyakarta': (-7.90, 110.25, -7.65, 110.50),
    'solo':       (-7.68, 110.70, -7.50, 110.92),
    'medan':      (3.52, 98.60, 3.70, 98.78),
    'palembang':  (-3.05, 104.70, -2.90, 104.85),
    'makassar':   (-5.18, 119.38, -5.08, 119.52),
    'denpasar':   (-8.78, 115.10, -8.55, 115.30),
}

# EPA AQI-US → PM2.5 inverse breakpoints
_EPA_BP = [
    (0,   50,  0.0,   12.0),
    (51,  100, 12.1,  35.4),
    (101, 150, 35.5,  55.4),
    (151, 200, 55.5,  150.4),
    (201, 300, 150.5, 250.4),
    (301, 500, 250.5, 500.4),
]


def aqi_us_to_pm25(aqi: float) -> float | None:
    if aqi is None or aqi < 0:
        return None
    try:
        a = float(aqi)
    except (TypeError, ValueError):
        return None
    for alo, ahi, clo, chi in _EPA_BP:
        if alo <= a <= ahi:
            return clo + ((chi - clo) * (a - alo) / (ahi - alo))
    return a * 0.4  # extrapolate above hazardous


def fetch_waqi(bbox: tuple[float, float, float, float], token: str) -> list[dict]:
    s, w, n, e = bbox
    url = f'https://api.waqi.info/map/bounds/?latlng={s},{w},{n},{e}&token={token}'
    try:
        r = httpx.get(url, timeout=20)
        body = r.json()
    except Exception as ex:
        log.warning(f'  WAQI fetch failed for bbox={bbox}: {ex}')
        return []
    if body.get('status') != 'ok':
        log.warning(f'  WAQI non-ok status: {body.get("status")} data={body.get("data")!r}')
        return []
    return body.get('data') or []


def fetch_iqair_nearest(region: str, bbox: tuple[float, float, float, float], api_key: str) -> dict | None:
    """One IQAir nearest_city per region (free tier 10k calls/mo). Approx region centroid."""
    s, w, n, e = bbox
    lat = (s + n) / 2.0
    lon = (w + e) / 2.0
    url = f'https://api.airvisual.com/v2/nearest_city?lat={lat}&lon={lon}&key={api_key}'
    try:
        r = httpx.get(url, timeout=15)
        body = r.json()
    except Exception as ex:
        log.warning(f'  IQAir fetch failed for {region}: {ex}')
        return None
    if body.get('status') != 'success':
        log.warning(f'  IQAir non-success for {region}: {body}')
        return None
    return body.get('data')


def upsert_snapshots(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO public.station_snapshots
          (station_uid, source, region, loc, pm25, measured_at)
        VALUES %s
        ON CONFLICT (station_uid, source, measured_at) DO NOTHING
    """
    template = "(%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),%s,%s)"
    with conn.cursor() as cur:
        execute_values(cur, sql, rows, template=template)
    conn.commit()
    return len(rows)


def poll_region(region: str, bbox, waqi_token: str | None, iqair_key: str | None,
                now: datetime) -> list[tuple]:
    rows: list[tuple] = []

    if waqi_token:
        stations = fetch_waqi(bbox, waqi_token)
        for st in stations:
            uid = st.get('uid')
            aqi_raw = st.get('aqi')
            lat = st.get('lat')
            lon = st.get('lon')
            if uid is None or lat is None or lon is None:
                continue
            try:
                aqi_val = float(aqi_raw)
            except (TypeError, ValueError):
                continue  # WAQI returns "-" for offline stations
            pm25 = aqi_us_to_pm25(aqi_val)
            if pm25 is None:
                continue
            # WAQI map endpoint doesn't return measured_at; use now() — UTC
            rows.append((str(uid), 'waqi', region, float(lon), float(lat), float(pm25), now))
        log.info(f'  {region:11s} waqi: {len(stations)} stations, {sum(1 for r in rows if r[1] == "waqi")} valid')

    if iqair_key:
        d = fetch_iqair_nearest(region, bbox, iqair_key)
        if d is not None:
            try:
                pm25 = float(d['current']['pollution']['aqius'])
                pm25 = aqi_us_to_pm25(pm25) or 0.0
                loc = d['location']['coordinates']  # [lon, lat]
                city = d.get('city', 'unknown')
                ts_str = d['current']['pollution']['ts']  # ISO 8601
                measured = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                rows.append((f'iqair:{region}:{city}', 'iqair', region,
                             float(loc[0]), float(loc[1]), float(pm25), measured))
                log.info(f'  {region:11s} iqair: 1 station ({city})')
            except Exception as ex:
                log.warning(f'  {region:11s} iqair parse failed: {ex}')

    return rows


def attach_ground_truth(conn) -> int:
    """Calls public.attach_station_ground_truth() — backfills prediction_logs."""
    with conn.cursor() as cur:
        cur.execute('SELECT updated_rows FROM public.attach_station_ground_truth(2.0, 2)')
        row = cur.fetchone()
    conn.commit()
    return int(row[0]) if row else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region', nargs='+', default=list(REGION_BBOXES.keys()))
    parser.add_argument('--no-attach', action='store_true',
                        help='Skip the attach_station_ground_truth call (poll only)')
    parser.add_argument('--no-iqair', action='store_true',
                        help='Skip IQAir nearest_city (saves quota)')
    args = parser.parse_args()

    env_path = Path('.env.local')
    if env_path.exists():
        load_dotenv(env_path)
    waqi_token = os.environ.get('WAQI_TOKEN') or os.environ.get('VITE_WAQI_TOKEN')
    iqair_key = None if args.no_iqair else os.environ.get('IQAIR_API_KEY')
    pooler = os.environ.get('SUPABASE_POOLER_URL')

    if not pooler:
        log.error('SUPABASE_POOLER_URL missing — cannot upsert')
        sys.exit(2)
    if not waqi_token and not iqair_key:
        log.error('neither WAQI_TOKEN nor IQAIR_API_KEY set — nothing to poll')
        sys.exit(2)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    log.info(f'starting poll for {len(args.region)} regions at {now.isoformat()}')

    all_rows: list[tuple] = []
    for region in args.region:
        bbox = REGION_BBOXES.get(region)
        if bbox is None:
            log.warning(f'  unknown region {region}, skipping')
            continue
        rows = poll_region(region, bbox, waqi_token, iqair_key, now)
        all_rows.extend(rows)

    log.info(f'collected {len(all_rows)} snapshot rows total')

    with psycopg2.connect(pooler) as conn:
        with conn.cursor() as cur:
            cur.execute('SET statement_timeout = 0')
        n_upserted = upsert_snapshots(conn, all_rows)
        log.info(f'upserted {n_upserted} rows to station_snapshots')

        if not args.no_attach:
            n_attached = attach_ground_truth(conn)
            log.info(f'attached ground truth to {n_attached} prediction_logs rows')

    log.info('done.')


if __name__ == '__main__':
    main()
