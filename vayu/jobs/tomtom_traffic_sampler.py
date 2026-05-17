"""
Playbook §4.1 — Hourly TomTom Traffic Flow sampler.

Per-region grid sample: fetch TomTom Traffic Flow segments inside region bbox,
aggregate to (road_class, hour, dow) and upsert traffic_calibration with the
ratio currentSpeed/freeFlowSpeed as correction_factor.

Run:
    python vayu/jobs/tomtom_traffic_sampler.py
    python vayu/jobs/tomtom_traffic_sampler.py --region jakarta
"""

from __future__ import annotations
import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import httpx
import psycopg2
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('tomtom_sampler')

# Sample one point per region (TomTom Flow Segment endpoint = point query)
REGION_PROBES: dict[str, list[tuple[float, float, str]]] = {
    # region: list of (lat, lon, road_class_target)
    'jakarta':    [(-6.20, 106.85, 'primary'), (-6.18, 106.83, 'secondary'), (-6.27, 106.83, 'residential')],
    'bali':       [(-8.65, 115.22, 'primary'), (-8.71, 115.16, 'secondary')],
    'bandung':    [(-6.91, 107.61, 'primary'), (-6.93, 107.62, 'residential')],
    'surabaya':   [(-7.27, 112.74, 'primary'), (-7.28, 112.74, 'secondary')],
    'semarang':   [(-6.98, 110.42, 'primary')],
    'yogyakarta': [(-7.79, 110.36, 'primary')],
    'medan':      [(3.60, 98.66, 'primary')],
    'palembang':  [(-2.99, 104.76, 'primary')],
    'makassar':   [(-5.13, 119.42, 'primary')],
}


def fetch_flow(api_key: str, lat: float, lon: float, zoom: int = 10) -> dict | None:
    url = f'https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/{zoom}/json'
    try:
        r = httpx.get(url, params={'point': f'{lat},{lon}', 'key': api_key}, timeout=10)
        if r.status_code != 200:
            log.warning(f'  {lat},{lon}: HTTP {r.status_code}')
            return None
        return r.json().get('flowSegmentData')
    except Exception as ex:
        log.warning(f'  {lat},{lon}: {ex}')
        return None


def upsert_sample(conn, road_class: str, hour: int, dow: int,
                  current_speed: float, free_flow_speed: float,
                  congestion: float, correction: float):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.traffic_calibration
              (road_class, hour_of_day, day_of_week,
               tomtom_avg_speed, tomtom_free_flow_speed,
               congestion_level, correction_factor, sample_count, calibrated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 1, NOW())
            """,
            (road_class, hour, dow, current_speed, free_flow_speed, congestion, correction),
        )
    conn.commit()


def poll_region(conn, region: str, api_key: str, now: datetime):
    probes = REGION_PROBES.get(region, [])
    hour = now.hour
    dow = now.weekday()  # 0=Mon
    inserted = 0
    for lat, lon, road_class in probes:
        flow = fetch_flow(api_key, lat, lon)
        if not flow:
            continue
        try:
            current = float(flow['currentSpeed'])
            free = float(flow['freeFlowSpeed'])
            if free <= 0:
                continue
            congestion = max(0.0, 1.0 - current / free)
            correction = current / free  # used to scale traffic emission downward when congested
            upsert_sample(conn, road_class, hour, dow, current, free, congestion, correction)
            inserted += 1
        except Exception as ex:
            log.warning(f'  parse failed: {ex}')
    log.info(f'  {region:11s} inserted {inserted}/{len(probes)} samples')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region', nargs='+', default=list(REGION_PROBES))
    args = parser.parse_args()

    load_dotenv('.env.local')
    pooler = os.environ.get('SUPABASE_POOLER_URL')
    api_key = os.environ.get('TOMTOM_API_KEY')
    if not pooler or not api_key:
        log.error('SUPABASE_POOLER_URL + TOMTOM_API_KEY required')
        sys.exit(2)

    now = datetime.now(timezone.utc)
    log.info(f'TomTom sampler @ {now.isoformat()} hour={now.hour} dow={now.weekday()}')

    with psycopg2.connect(pooler) as conn:
        for region in args.region:
            poll_region(conn, region, api_key, now)
    log.info('done.')


if __name__ == '__main__':
    main()
