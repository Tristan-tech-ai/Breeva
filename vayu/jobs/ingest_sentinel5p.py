"""
VAYU Engine — Sentinel-5P TROPOMI L2 daily ingest (Phase 1.2).

Pipeline:
  1. CDSE OAuth (password grant)             → bearer token (10 min lifetime)
  2. OData search Indonesia bbox last 24h    → list NO2/SO2/CO/O3 products
  3. Stream-download .nc NetCDF files        → tmp/sentinel5p/
  4. Parse with xarray + filter qa_value>0.75 → flat lat/lng/value arrays
  5. Re-grid to H3 res 7 (~5km hex) mean    → per-cell aggregate
  6. Compute PM2.5 proxy via region NO2→PM2.5 ratio
  7. UPSERT public.aqi_grid_sentinel via psycopg2 + execute_values
  8. Log invocation row to public.sentinel5p_ingest_log

Run:
    python vayu/jobs/ingest_sentinel5p.py --date 2026-05-15
    python vayu/jobs/ingest_sentinel5p.py --backfill 3
    python vayu/jobs/ingest_sentinel5p.py            # yesterday UTC

Scheduled daily via Windows Task Scheduler 04:00 WIB (T_ schedule below).
Free tier CDSE quota: 30,000 downloads/month — daily ingest ≈ 600/month.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Load .env.local so CDSE_USERNAME, SUPABASE_POOLER_URL are present.
def _load_env_local():
    repo_root = Path(__file__).resolve().parents[2]
    for fname in ('.env.local', '.env'):
        p = repo_root / fname
        if not p.exists():
            continue
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip("'").strip('"')
            if k and k not in os.environ:
                os.environ[k] = v
_load_env_local()

import h3
import httpx
import numpy as np
import psycopg2
import xarray as xr
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('sentinel5p')

INDONESIA_BBOX = (95.0, -11.0, 141.0, 6.0)  # (west, south, east, north)
H3_RESOLUTION = 7  # ~5km hex

# Empirical NO2 column → surface PM2.5 ratio (μg/m³ per 10^15 molec/cm²).
# Initial values from regression on Jakarta 2024-2025 station vs Sentinel pairs.
# TODO: re-calibrate per-region setelah punya >1k pair samples (Phase 2.1 corpus).
NO2_TO_PM25_RATIO = {
    'jakarta': 12.5, 'bali': 8.0, 'bandung': 11.0, 'surabaya': 11.5,
    'semarang': 10.5, 'yogyakarta': 9.5, 'solo': 10.0,
    'medan': 11.0, 'palembang': 10.5, 'makassar': 10.0, 'malang': 9.0,
    'sulsel': 10.0, 'sulut': 9.5, 'sulteng': 9.5, 'sultra': 9.5, 'sulbar': 9.5,
    'gorontalo': 9.5, 'default': 10.0,
}


def get_cdse_token() -> str:
    user = os.environ.get('CDSE_USERNAME')
    pw = os.environ.get('CDSE_PASSWORD')
    if not user or not pw:
        raise RuntimeError('CDSE_USERNAME / CDSE_PASSWORD not in env')
    r = httpx.post(
        'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
        data={'client_id': 'cdse-public', 'username': user, 'password': pw, 'grant_type': 'password'},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()['access_token']


def search_products(token: str, date: datetime, product_type: str = 'L2__NO2___') -> list[dict]:
    """OData v1 catalogue query untuk Sentinel-5P L2 di Indonesia bbox."""
    start = date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    w, s, e, n = INDONESIA_BBOX
    polygon = f'POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))'
    odata_filter = (
        f"Collection/Name eq 'SENTINEL-5P' and "
        f"contains(Name,'{product_type}') and "
        f"ContentDate/Start gt {start.strftime('%Y-%m-%dT%H:%M:%S.000Z')} and "
        f"ContentDate/Start lt {end.strftime('%Y-%m-%dT%H:%M:%S.000Z')} and "
        f"OData.CSC.Intersects(area=geography'SRID=4326;{polygon}')"
    )
    r = httpx.get(
        'https://catalogue.dataspace.copernicus.eu/odata/v1/Products',
        params={'$filter': odata_filter, '$top': 30, '$orderby': 'ContentDate/Start desc'},
        headers={'Authorization': f'Bearer {token}'},
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get('value', [])


def download_product(token: str, product: dict, dest_dir: Path) -> Path | None:
    name = product['Name']
    pid = product['Id']
    dest = dest_dir / f'{name}.nc'
    if dest.exists() and dest.stat().st_size > 1024 * 1024:
        log.info(f'  cached {name}')
        return dest
    try:
        # CDSE redirects catalogue.* → download.* (different subdomain). httpx
        # strips Authorization across hosts by default, so we follow redirects
        # manually and re-attach the Bearer header on each hop.
        url = f'https://catalogue.dataspace.copernicus.eu/odata/v1/Products({pid})/$value'
        hops = 0
        with httpx.Client(timeout=600) as client:
            while hops < 5:
                resp = client.get(url, headers={'Authorization': f'Bearer {token}'}, follow_redirects=False)
                if resp.status_code in (301, 302, 303, 307, 308):
                    url = resp.headers.get('location')
                    if not url:
                        raise RuntimeError(f'redirect missing Location header (hop {hops})')
                    hops += 1
                    continue
                resp.raise_for_status()
                # Now stream the final URL
                break
            # Re-fetch as stream for the final URL
            with client.stream('GET', url, headers={'Authorization': f'Bearer {token}'}, follow_redirects=False) as r:
                r.raise_for_status()
                with open(dest, 'wb') as f:
                    for chunk in r.iter_bytes(chunk_size=8 * 1024 * 1024):
                        f.write(chunk)
        log.info(f'  saved {name} ({dest.stat().st_size / 1e6:.1f} MB)')
        return dest
    except Exception as exc:
        log.error(f'  download fail {name}: {exc}')
        if dest.exists() and dest.stat().st_size < 1024 * 1024:
            dest.unlink(missing_ok=True)
        return None


def parse_no2(nc_path: Path) -> dict | None:
    """Parse Sentinel-5P NO2 → arrays of lat/lng/no2_column (10^15 molec/cm²)."""
    try:
        ds = xr.open_dataset(nc_path, group='PRODUCT', decode_times=False)
    except Exception as exc:
        log.error(f'  xarray open fail {nc_path.name}: {exc}')
        return None
    try:
        lat = ds['latitude'].values.flatten()
        lng = ds['longitude'].values.flatten()
        no2 = ds['nitrogendioxide_tropospheric_column'].values.flatten()
        qa = ds['qa_value'].values.flatten()
    finally:
        ds.close()
    mask = (qa > 0.75) & np.isfinite(no2) & (no2 > 0)
    # mol/m² → 10^15 molec/cm² (Avogadro × 1e-15 × 1e-4)
    no2_conv = no2[mask] * 6.022e23 / 1e15 / 1e4
    return {'lat': lat[mask], 'lng': lng[mask], 'value': no2_conv}


def regrid_to_h3(data: dict) -> dict[str, dict]:
    cells: dict[str, list[float]] = {}
    for lat, lng, val in zip(data['lat'], data['lng'], data['value']):
        try:
            cell = h3.latlng_to_cell(float(lat), float(lng), H3_RESOLUTION)
        except Exception:
            continue
        cells.setdefault(cell, []).append(float(val))
    return {
        cell: {'mean': float(np.mean(vs)), 'count': len(vs), 'std': float(np.std(vs)) if len(vs) > 1 else 0.0}
        for cell, vs in cells.items()
    }


def guess_region(lat: float, lng: float) -> str:
    if -6.3 < lat < -6.0 and 106.7 < lng < 107.0: return 'jakarta'
    if -8.85 < lat < -8.5 and 115.05 < lng < 115.3: return 'bali'
    if -7.0 < lat < -6.85 and 107.55 < lng < 107.7: return 'bandung'
    if -7.35 < lat < -7.2 and 112.7 < lng < 112.8: return 'surabaya'
    if -7.1 < lat < -6.9 and 110.3 < lng < 110.55: return 'semarang'
    if -7.9 < lat < -7.65 and 110.25 < lng < 110.5: return 'yogyakarta'
    if -7.68 < lat < -7.5 and 110.7 < lng < 110.92: return 'solo'
    if 3.5 < lat < 3.7 and 98.6 < lng < 98.78: return 'medan'
    if -3.05 < lat < -2.9 and 104.7 < lng < 104.85: return 'palembang'
    if -5.18 < lat < -5.08 and 119.38 < lng < 119.52: return 'makassar'
    if -8.0 < lat < -7.94 and 112.6 < lng < 112.66: return 'malang'
    if -5.6 < lat < -2.8 and 119.25 < lng < 120.65: return 'sulsel'
    return 'default'


def upsert_to_supabase(rows: list[tuple], acquired_at: datetime, dsn: str):
    sql = """
        INSERT INTO public.aqi_grid_sentinel (
            cell_id, centroid_lat, centroid_lng,
            sentinel_no2, sentinel_so2, sentinel_co, sentinel_o3,
            sentinel_pm25_proxy, sentinel_acquired_at, sentinel_cloud_fraction,
            measurement_count
        ) VALUES %s
        ON CONFLICT (cell_id) DO UPDATE SET
            centroid_lat = EXCLUDED.centroid_lat,
            centroid_lng = EXCLUDED.centroid_lng,
            sentinel_no2 = COALESCE(EXCLUDED.sentinel_no2, public.aqi_grid_sentinel.sentinel_no2),
            sentinel_so2 = COALESCE(EXCLUDED.sentinel_so2, public.aqi_grid_sentinel.sentinel_so2),
            sentinel_co = COALESCE(EXCLUDED.sentinel_co, public.aqi_grid_sentinel.sentinel_co),
            sentinel_o3 = COALESCE(EXCLUDED.sentinel_o3, public.aqi_grid_sentinel.sentinel_o3),
            sentinel_pm25_proxy = EXCLUDED.sentinel_pm25_proxy,
            sentinel_acquired_at = EXCLUDED.sentinel_acquired_at,
            sentinel_cloud_fraction = EXCLUDED.sentinel_cloud_fraction,
            measurement_count = EXCLUDED.measurement_count,
            updated_at = NOW();
    """
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            execute_values(cur, sql, rows, page_size=500)
        conn.commit()
    finally:
        conn.close()


def log_invocation(dsn: str, invocation_date: datetime, products_found: int,
                   cells_updated: int, status: str, error: str | None,
                   started_at: datetime, ended_at: datetime):
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO public.sentinel5p_ingest_log
                (invocation_date, products_found, cells_updated, status, error, started_at, ended_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s);
            """, (invocation_date.date(), products_found, cells_updated, status, error, started_at, ended_at))
        conn.commit()
    finally:
        conn.close()


def process_one_day(date: datetime, dest_dir: Path, dsn: str, products_limit: int = 5):
    started = datetime.now(timezone.utc)
    token = get_cdse_token()
    log.info(f'CDSE token acquired')

    # Collect arrays across all products of all types for the day
    aggregated: dict[str, dict[str, float]] = {}  # cell_id → {no2, so2, co, o3, count}

    for product_type, parse_fn, value_key in [
        ('L2__NO2___', parse_no2, 'no2'),
        # NOTE: SO2/CO/O3 parsers serupa — copy parse_no2 with different variable names. Not enabled yet.
    ]:
        log.info(f'Searching {product_type} for {date.date()}')
        products = search_products(token, date, product_type)
        log.info(f'  found {len(products)} products')

        all_lat, all_lng, all_val = [], [], []
        for prod in products[:products_limit]:
            nc_path = download_product(token, prod, dest_dir)
            if not nc_path:
                continue
            parsed = parse_fn(nc_path)
            if not parsed or len(parsed['lat']) == 0:
                continue
            all_lat.append(parsed['lat'])
            all_lng.append(parsed['lng'])
            all_val.append(parsed['value'])

        if not all_lat:
            log.warning(f'  no valid data for {product_type}')
            continue

        merged = {
            'lat': np.concatenate(all_lat),
            'lng': np.concatenate(all_lng),
            'value': np.concatenate(all_val),
        }
        log.info(f'  total points: {len(merged["lat"])}')
        cells = regrid_to_h3(merged)
        log.info(f'  aggregated to {len(cells)} H3 cells')

        for cell_id, v in cells.items():
            entry = aggregated.setdefault(cell_id, {})
            entry[value_key] = v['mean']
            entry['count'] = max(int(entry.get('count', 0)), v['count'])

    if not aggregated:
        log.warning('No usable data this day. Logging empty invocation.')
        log_invocation(dsn, date, 0, 0, 'empty', None, started, datetime.now(timezone.utc))
        return

    # Build upsert rows
    rows: list[tuple] = []
    for cell_id, v in aggregated.items():
        try:
            lat, lng = h3.cell_to_latlng(cell_id)
        except Exception:
            continue
        region = guess_region(lat, lng)
        ratio = NO2_TO_PM25_RATIO.get(region, NO2_TO_PM25_RATIO['default'])
        no2 = v.get('no2')
        so2 = v.get('so2')
        co = v.get('co')
        o3 = v.get('o3')
        pm25_proxy = no2 * ratio if no2 is not None else None
        rows.append((
            cell_id, float(lat), float(lng),
            no2, so2, co, o3,
            pm25_proxy, date, 0.0,  # cloud_fraction TBD when we add cloud parsing
            int(v.get('count', 0)),
        ))

    log.info(f'Upserting {len(rows)} cells to aqi_grid_sentinel')
    upsert_to_supabase(rows, date, dsn)
    log.info(f'OK — {len(rows)} cells updated')

    log_invocation(dsn, date, sum(1 for _ in aggregated), len(rows), 'ok', None,
                   started, datetime.now(timezone.utc))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', help='YYYY-MM-DD (default: yesterday UTC)')
    parser.add_argument('--backfill', type=int, default=0, help='Days to backfill')
    parser.add_argument('--dest-dir', default='./tmp/sentinel5p')
    parser.add_argument('--products-limit', type=int, default=5, help='Max products per type per day')
    args = parser.parse_args()

    dsn = os.environ.get('SUPABASE_POOLER_URL')
    if not dsn:
        log.error('SUPABASE_POOLER_URL not set')
        sys.exit(1)

    Path(args.dest_dir).mkdir(parents=True, exist_ok=True)

    if args.backfill > 0:
        dates = [datetime.now(timezone.utc) - timedelta(days=i + 1) for i in range(args.backfill)]
    elif args.date:
        dates = [datetime.fromisoformat(args.date).replace(tzinfo=timezone.utc)]
    else:
        dates = [datetime.now(timezone.utc) - timedelta(days=1)]

    for date in dates:
        log.info(f'=== Processing {date.date()} ===')
        try:
            process_one_day(date, Path(args.dest_dir), dsn, args.products_limit)
        except Exception as exc:
            log.exception(f'FAILED for {date.date()}: {exc}')
            try:
                log_invocation(dsn, date, 0, 0, 'error', str(exc)[:500],
                               datetime.now(timezone.utc), datetime.now(timezone.utc))
            except Exception:
                pass


if __name__ == '__main__':
    main()
