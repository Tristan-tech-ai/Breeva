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
# 2026-05-24 PIVOT: jakarta widened to Jabodetabek (Bekasi+Tangerang+Depok+Bogor),
# bali kept widened. Added 'malang'. Region label 'jakarta' continues from existing
# history but bbox now covers wider Jabodetabek per Tristan priority.
REGION_BBOXES: dict[str, tuple[float, float, float, float]] = {
    'jakarta':    (-6.50, 106.40, -5.95, 107.15),   # PIVOT: Jabodetabek (was -6.30,106.75,-6.10,106.95)
    'bali':       (-8.85, 115.00, -8.20, 115.72),   # Badung+Gianyar+Karangasem+Tabanan+Ubud+Sanur
    'bandung':    (-6.95, 107.57, -6.87, 107.67),
    'surabaya':   (-7.33, 112.70, -7.23, 112.80),
    'semarang':   (-7.10, 110.30, -6.90, 110.55),
    'yogyakarta': (-7.90, 110.25, -7.65, 110.50),
    'solo':       (-7.68, 110.70, -7.50, 110.92),
    'medan':      (3.52, 98.60, 3.70, 98.78),
    'palembang':  (-3.05, 104.70, -2.90, 104.85),
    'makassar':   (-5.18, 119.38, -5.08, 119.52),
    'malang':     (-8.05, 112.55, -7.85, 112.75),   # added 2026-05-24
    'denpasar':   (-8.78, 115.10, -8.55, 115.30),
}

# 2026-05-24 PIVOT: IQAir grid sampling spec per region.
# Format: (rows, cols) — points sampled evenly within bbox.
# 1×1 = single centroid query (legacy behavior).
# Jakarta+Bali = priority demo regions → dense grid.
# 9 other regions = sparse grid to balance coverage vs API quota.
# Total per hour: 49 + 25 + 9*4 = 110 IQAir calls = 79k/mo of 130k capacity (61%).
GRID_SPEC: dict[str, tuple[int, int]] = {
    'jakarta':    (7, 7),  # 49 points — Jabodetabek dense
    'bali':       (5, 5),  # 25 points — entire Bali dense
    'bandung':    (2, 2),  # 4 points
    'surabaya':   (2, 2),
    'semarang':   (2, 2),
    'yogyakarta': (2, 2),
    'solo':       (2, 2),
    'medan':      (2, 2),
    'palembang':  (2, 2),
    'makassar':   (2, 2),
    'malang':     (2, 2),
    'denpasar':   (1, 1),  # legacy single point (overlaps bali, low priority)
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


class WAQIKeyRotator:
    """Round-robin across N WAQI tokens with per-token 60s cooldown on failure.

    Configures via WAQI_TOKENS (comma-separated) — falls back to single
    WAQI_TOKEN / VITE_WAQI_TOKEN for backwards compat. WAQI sparse di Indonesia
    so rotator mostly redundant but provides safety for failed-token replacement.
    Added 2026-05-24 after token ...4629 leaked publicly and was deactivated.
    """

    def __init__(self, tokens: list[str]):
        self.tokens = [t.strip() for t in tokens if t.strip()]
        self.cooldown_until: dict[str, float] = {}
        self._idx = 0

    def pick(self) -> str | None:
        import time
        now = time.time()
        for _ in range(len(self.tokens)):
            tok = self.tokens[self._idx % len(self.tokens)]
            self._idx += 1
            if self.cooldown_until.get(tok, 0) <= now:
                return tok
        return None

    def mark_failed(self, token: str, seconds: float = 60.0):
        import time
        self.cooldown_until[token] = time.time() + seconds


def fetch_waqi(bbox: tuple[float, float, float, float], rotator_or_token) -> list[dict]:
    """Fetch WAQI stations within bbox. Accepts either WAQIKeyRotator or single token string."""
    s, w, n, e = bbox
    if isinstance(rotator_or_token, WAQIKeyRotator):
        # Try up to 3 tokens before giving up
        for _ in range(min(3, len(rotator_or_token.tokens))):
            token = rotator_or_token.pick()
            if token is None:
                log.warning(f'  WAQI all tokens on cooldown for bbox={bbox}')
                return []
            url = f'https://api.waqi.info/map/bounds/?latlng={s},{w},{n},{e}&token={token}'
            try:
                r = httpx.get(url, timeout=20)
                body = r.json()
            except Exception as ex:
                log.warning(f'  WAQI fetch failed for bbox={bbox}: {ex}')
                rotator_or_token.mark_failed(token)
                continue
            if body.get('status') == 'ok':
                return body.get('data') or []
            # Non-ok: token issue or rate limit
            log.warning(f'  WAQI non-ok status={body.get("status")} for token ending {token[-4:]}, trying next')
            rotator_or_token.mark_failed(token)
            continue
        return []
    # Legacy single-token path
    token = rotator_or_token
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


class IQAirKeyRotator:
    """Round-robin across N keys with per-key 60s cooldown on 429.

    User configures IQAIR_API_KEYS (comma-separated) — falls back to single
    IQAIR_API_KEY for backwards compatibility. Free tier per key: 10k/mo,
    5/min. With 5 keys you get 25/min and 50k/mo — covers hourly 9-region
    polling 24/7 (216 calls/day × 30 = 6.5k/mo per key).
    """

    def __init__(self, keys: list[str]):
        self.keys = [k.strip() for k in keys if k.strip()]
        self.cooldown_until: dict[str, float] = {}
        self._idx = 0

    def pick(self) -> str | None:
        import time
        now = time.time()
        for _ in range(len(self.keys)):
            key = self.keys[self._idx % len(self.keys)]
            self._idx += 1
            if self.cooldown_until.get(key, 0) <= now:
                return key
        return None  # all keys on cooldown

    def mark_429(self, key: str, seconds: float = 60.0):
        import time
        self.cooldown_until[key] = time.time() + seconds


def fetch_iqair_nearest(region: str, bbox: tuple[float, float, float, float],
                        rotator: IQAirKeyRotator,
                        lat_override: float | None = None,
                        lon_override: float | None = None) -> dict | None:
    """One IQAir nearest_city per (region, lat, lon) via key rotator.

    lat_override/lon_override allow grid sampling — caller passes specific point.
    Default: centroid of bbox (legacy behavior).
    """
    s, w, n, e = bbox
    lat = lat_override if lat_override is not None else (s + n) / 2.0
    lon = lon_override if lon_override is not None else (w + e) / 2.0
    for _ in range(min(3, len(rotator.keys))):
        api_key = rotator.pick()
        if api_key is None:
            log.warning(f'  IQAir all keys on cooldown for {region}@{lat:.3f},{lon:.3f}')
            return None
        url = f'https://api.airvisual.com/v2/nearest_city?lat={lat}&lon={lon}&key={api_key}'
        try:
            r = httpx.get(url, timeout=15)
            body = r.json()
        except Exception as ex:
            log.warning(f'  IQAir fetch failed for {region}@{lat:.3f},{lon:.3f}: {ex}')
            return None
        if body.get('status') == 'success':
            return body.get('data')
        msg = str(body.get('data', {}).get('message', '') or body.get('status'))
        if 'too many' in msg.lower() or '429' in msg or 'limit' in msg.lower():
            rotator.mark_429(api_key)
            continue  # try next key
        log.warning(f'  IQAir non-success for {region}@{lat:.3f},{lon:.3f}: {body.get("data", body)}')
        return None
    return None


def fetch_iqair_grid(region: str, bbox: tuple[float, float, float, float],
                     rotator: IQAirKeyRotator, grid_rows: int, grid_cols: int) -> list[dict]:
    """Grid sampling: query IQAir nearest_city at each grid point within bbox.

    Returns list of unique station data dicts. Dedup by city + coordinates.
    For 7×7 grid (Jakarta_Jabodetabek): 49 IQAir API calls per invocation.
    """
    s, w, n, e = bbox
    seen_uids: set[str] = set()
    stations: list[dict] = []

    if grid_rows < 1 or grid_cols < 1:
        return []

    # Evenly spaced grid points within bbox (excluding boundary to avoid edge clustering)
    lat_step = (n - s) / (grid_rows + 1) if grid_rows > 1 else 0
    lon_step = (e - w) / (grid_cols + 1) if grid_cols > 1 else 0

    for i in range(grid_rows):
        for j in range(grid_cols):
            if grid_rows == 1:
                lat = (s + n) / 2.0
            else:
                lat = s + (i + 1) * lat_step
            if grid_cols == 1:
                lon = (w + e) / 2.0
            else:
                lon = w + (j + 1) * lon_step

            data = fetch_iqair_nearest(region, bbox, rotator, lat_override=lat, lon_override=lon)
            if data is None:
                continue
            try:
                city = data.get('city', '')
                state = data.get('state', '')
                country = data.get('country', '')
                # Dedup by city+state+country (Cleaner than coordinates since IQAir snaps)
                uid_key = f'{country}|{state}|{city}'
                if uid_key in seen_uids:
                    continue
                seen_uids.add(uid_key)
                stations.append(data)
            except Exception:
                continue
    return stations


# ─── OpenAQ v3 (FREE, no key, 60 req/min) ─────────────────────────────
# Aggregates BMKG + EEA + EPA + 100+ networks. Returns latest PM2.5 per location
# within a bbox. Significantly denser coverage than WAQI for Tier-B regions
# (Sumatera/Sulawesi often have BMKG stations not visible in WAQI feed).

def fetch_openaq(bbox: tuple[float, float, float, float], api_key: str | None,
                 hours_back: int = 6) -> list[dict]:
    """OpenAQ v3 — requires free X-API-Key (register at https://explore.openaq.org/register)."""
    if not api_key:
        return []  # silently skip if not configured
    s, w, n, e = bbox
    headers = {'X-API-Key': api_key}
    url = 'https://api.openaq.org/v3/locations'
    params = {
        'bbox': f'{w},{s},{e},{n}',
        'parameters_id': 2,  # PM2.5
        'limit': 100,
    }
    try:
        r = httpx.get(url, params=params, headers=headers, timeout=20)
        if r.status_code != 200:
            log.warning(f'  OpenAQ locations HTTP {r.status_code} ({r.text[:120]})')
            return []
        locs = r.json().get('results') or []
    except Exception as ex:
        log.warning(f'  OpenAQ locations failed: {ex}')
        return []

    out: list[dict] = []
    for loc in locs[:100]:
        sensors = loc.get('sensors') or []
        pm25_sensors = [s for s in sensors if s.get('parameter', {}).get('id') == 2]
        if not pm25_sensors:
            continue
        sensor_id = pm25_sensors[0].get('id')
        try:
            mr = httpx.get(
                f'https://api.openaq.org/v3/sensors/{sensor_id}/measurements',
                params={'limit': 1, 'order_by': 'datetime', 'sort_order': 'desc'},
                headers=headers, timeout=15,
            )
            if mr.status_code != 200:
                continue
            results = mr.json().get('results') or []
            if not results:
                continue
            latest = results[0]
            coords = loc.get('coordinates') or {}
            out.append({
                'uid': str(loc.get('id')),
                'lat': coords.get('latitude'),
                'lon': coords.get('longitude'),
                'pm25': latest.get('value'),
                'measured_at': latest.get('period', {}).get('datetimeTo', {}).get('utc'),
            })
        except Exception:
            continue
    return out


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


def poll_region(region: str, bbox,
                waqi_rotator_or_token,
                iqair_rotator: IQAirKeyRotator | None,
                openaq_key: str | None,
                now: datetime,
                grid_spec: tuple[int, int] = (1, 1)) -> list[tuple]:
    """Poll one region from WAQI + IQAir (grid sampling) + OpenAQ.

    grid_spec: (rows, cols) for IQAir nearest_city grid. (1,1) = single centroid (legacy).
    Higher = more IQAir calls but more station coverage. Per GRID_SPEC in module.
    """
    rows: list[tuple] = []

    if waqi_rotator_or_token:
        stations = fetch_waqi(bbox, waqi_rotator_or_token)
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
            rows.append((str(uid), 'waqi', region, float(lon), float(lat), float(pm25), now))
        log.info(f'  {region:11s} waqi: {len(stations)} stations, {sum(1 for r in rows if r[1] == "waqi")} valid')

    if iqair_rotator is not None and iqair_rotator.keys:
        grid_rows, grid_cols = grid_spec
        n_points = grid_rows * grid_cols
        if n_points == 1:
            # Legacy single-station centroid query
            d = fetch_iqair_nearest(region, bbox, iqair_rotator)
            iqair_data = [d] if d is not None else []
        else:
            # Grid sampling for priority regions
            iqair_data = fetch_iqair_grid(region, bbox, iqair_rotator, grid_rows, grid_cols)
        valid_iqair = 0
        for d in iqair_data:
            try:
                pm25 = float(d['current']['pollution']['aqius'])
                pm25 = aqi_us_to_pm25(pm25) or 0.0
                loc = d['location']['coordinates']  # [lon, lat]
                city = d.get('city', 'unknown')
                state = d.get('state', '')
                ts_str = d['current']['pollution']['ts']  # ISO 8601
                measured = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                # UID includes state+city for uniqueness across regions (e.g., "Jakarta" exists in DKI + West Java cities)
                uid_str = f'iqair:{state}:{city}' if state else f'iqair:{region}:{city}'
                rows.append((uid_str, 'iqair', region,
                             float(loc[0]), float(loc[1]), float(pm25), measured))
                valid_iqair += 1
            except Exception as ex:
                log.warning(f'  {region:11s} iqair parse failed: {ex}')
        log.info(f'  {region:11s} iqair: grid {grid_rows}x{grid_cols} -> {len(iqair_data)} unique stations, {valid_iqair} valid')

    if openaq_key:
        oa = fetch_openaq(bbox, openaq_key, hours_back=6)
        valid = 0
        for st in oa:
            try:
                pm25 = float(st['pm25'])
                lat = float(st['lat'])
                lon = float(st['lon'])
            except (TypeError, ValueError, KeyError):
                continue
            if pm25 < 0 or pm25 > 1000:
                continue
            measured_str = st.get('measured_at')
            if measured_str:
                try:
                    measured = datetime.fromisoformat(measured_str.replace('Z', '+00:00'))
                except Exception:
                    measured = now
            else:
                measured = now
            rows.append((f'openaq:{st["uid"]}', 'openaq', region,
                         lon, lat, pm25, measured))
            valid += 1
        if oa:
            log.info(f'  {region:11s} openaq: {len(oa)} locations, {valid} valid')

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
    parser.add_argument('--no-openaq', action='store_true',
                        help='Skip OpenAQ v3 polling')
    args = parser.parse_args()

    env_path = Path('.env.local')
    if env_path.exists():
        load_dotenv(env_path)

    # WAQI multi-token rotator (2026-05-24 PIVOT). Falls back to single token for compat.
    waqi_rotator_or_token = None
    raw_waqi_tokens = os.environ.get('WAQI_TOKENS', '').strip()
    if raw_waqi_tokens:
        tokens = [t.strip() for t in raw_waqi_tokens.split(',') if t.strip()]
        if tokens:
            waqi_rotator_or_token = WAQIKeyRotator(tokens)
            log.info(f'WAQI rotator: {len(tokens)} token(s)')
    if waqi_rotator_or_token is None:
        single = os.environ.get('WAQI_TOKEN') or os.environ.get('VITE_WAQI_TOKEN')
        if single:
            waqi_rotator_or_token = single
            log.info('WAQI: 1 token (single, no rotator)')

    # IQAir multi-key: parse IQAIR_API_KEYS (comma-separated) first, then fall
    # back to single IQAIR_API_KEY. 13 free-tier keys → 65/min, 130k/mo (post 2026-05-24 expansion).
    iqair_rotator: IQAirKeyRotator | None = None
    if not args.no_iqair:
        raw_keys = os.environ.get('IQAIR_API_KEYS')
        if raw_keys:
            keys = [k.strip() for k in raw_keys.split(',') if k.strip()]
        else:
            single = os.environ.get('IQAIR_API_KEY')
            keys = [single] if single else []
        if keys:
            iqair_rotator = IQAirKeyRotator(keys)
            log.info(f'IQAir rotator: {len(keys)} key(s)')

    openaq_key = None if args.no_openaq else os.environ.get('OPENAQ_API_KEY')
    if openaq_key:
        log.info('OpenAQ: enabled (free X-API-Key registered)')
    pooler = os.environ.get('SUPABASE_POOLER_URL')

    if not pooler:
        log.error('SUPABASE_POOLER_URL missing — cannot upsert')
        sys.exit(2)
    if not waqi_rotator_or_token and iqair_rotator is None and not openaq_key:
        log.error('no sources enabled (need WAQI_TOKEN(S), IQAIR_API_KEY(S), or OPENAQ_API_KEY)')
        sys.exit(2)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    log.info(f'starting poll for {len(args.region)} regions at {now.isoformat()}')

    all_rows: list[tuple] = []
    for region in args.region:
        bbox = REGION_BBOXES.get(region)
        if bbox is None:
            log.warning(f'  unknown region {region}, skipping')
            continue
        grid_spec = GRID_SPEC.get(region, (1, 1))  # default single centroid query
        rows = poll_region(region, bbox, waqi_rotator_or_token, iqair_rotator, openaq_key, now, grid_spec=grid_spec)
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
