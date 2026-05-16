"""
VAYU — Hourly LSTM forecast inference (Phase 2.2).

Triggered hourly from Windows Task Scheduler. For each region with an active
lstm_aqi_24h model, loads recent 72h history per cell, predicts next 24h pm25,
upserts to public.aqi_forecast.

Run:
    python vayu/ml/forecast_hourly.py
    python vayu/ml/forecast_hourly.py --region jakarta
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

def _load_env_local():
    repo_root = Path(__file__).resolve().parents[2]
    for fname in ('.env.local', '.env'):
        p = repo_root / fname
        if not p.exists():
            continue
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip("'").strip('"')
            if k and k not in os.environ:
                os.environ[k] = v
_load_env_local()

import numpy as np
import psycopg2
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from train_residual_lstm import AqiLSTM, DEVICE, LOOKBACK, HORIZON

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('forecast_hourly')


def aqi_from_pm25(pm25: float) -> int:
    if pm25 <= 12: return int(pm25 * 50 / 12)
    if pm25 <= 35.4: return int(50 + (pm25 - 12) * 50 / 23.4)
    if pm25 <= 55.4: return int(100 + (pm25 - 35.4) * 50 / 20)
    if pm25 <= 150.4: return int(150 + (pm25 - 55.4) * 100 / 95)
    if pm25 <= 250.4: return int(min(500, 250 + (pm25 - 150.4) * 100 / 100))
    return 500


def find_active_models(conn, region: str | None) -> list[tuple[str | None, str]]:
    """Returns (region, artifact_path) for active LSTM models."""
    if region:
        sql = "SELECT region, artifact_path FROM public.ml_model_registry WHERE model_name='lstm_aqi_24h' AND active=TRUE AND region=%s"
        params = (region,)
    else:
        sql = "SELECT region, artifact_path FROM public.ml_model_registry WHERE model_name='lstm_aqi_24h' AND active=TRUE"
        params = ()
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def run_forecast(conn, region: str | None, artifact_path: str):
    if not Path(artifact_path).exists():
        log.warning(f'Model artifact missing: {artifact_path} — skip')
        return

    model = AqiLSTM().to(DEVICE)
    model.load_state_dict(torch.load(artifact_path, map_location=DEVICE, weights_only=True))
    model.eval()

    where_region = "AND region = %s" if region else ""
    params = (region,) if region else ()
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT DISTINCT cell_id FROM public.aqi_grid
            WHERE computed_at > NOW() - INTERVAL '7 days' {where_region}
              AND pm25 IS NOT NULL
            LIMIT 5000;
        """, params)
        cells = [r[0] for r in cur.fetchall()]

    log.info(f'Forecasting {len(cells)} cells for region={region or "global"}')
    now = datetime.now(timezone.utc)
    forecasts: list[tuple] = []

    for cell in cells:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                  AVG(pm25)::real AS pm25,
                  AVG(no2)::real AS no2,
                  EXTRACT(HOUR FROM date_trunc('hour', computed_at))::int AS h,
                  EXTRACT(DOW FROM date_trunc('hour', computed_at))::int AS d
                FROM public.aqi_grid
                WHERE cell_id = %s AND computed_at > NOW() - INTERVAL '72 hours'
                  AND pm25 IS NOT NULL
                GROUP BY date_trunc('hour', computed_at)
                ORDER BY date_trunc('hour', computed_at) ASC;
            """, (cell,))
            rows = cur.fetchall()
        if len(rows) < 24:
            continue
        # Normalize same as training
        x = np.array([
            [
                min(max((r[0] or 0) / 300.0, 0), 1),
                min(max((r[1] or 0) / 200.0, 0), 1),
                (r[2] or 0) / 23.0,
                (r[3] or 0) / 6.0,
                1.0 if (r[3] or 0) >= 5 else 0.0,
            ]
            for r in rows
        ], dtype=np.float32)
        if len(x) < LOOKBACK:
            pad = np.repeat(x[:1], LOOKBACK - len(x), axis=0)
            x = np.vstack([pad, x])
        x = x[-LOOKBACK:]
        x_t = torch.tensor(x).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            pred = model(x_t).cpu().numpy().flatten() * 300.0  # denormalize
        for h in range(HORIZON):
            pm25 = float(pred[h])
            forecasts.append((cell, h, pm25, aqi_from_pm25(pm25), now))

    if not forecasts:
        log.info('No forecasts generated (insufficient history per cell)')
        return

    with conn.cursor() as cur:
        cur.executemany("""
            INSERT INTO public.aqi_forecast
              (cell_id, forecast_hour, predicted_pm25, predicted_aqi, forecast_made_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (cell_id, forecast_hour, forecast_made_at) DO NOTHING;
        """, forecasts)
    conn.commit()
    log.info(f'Inserted {len(forecasts)} forecast rows for region={region or "global"}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region')
    args = parser.parse_args()

    dsn = os.environ.get('SUPABASE_POOLER_URL')
    if not dsn:
        log.error('SUPABASE_POOLER_URL not set'); sys.exit(1)

    conn = psycopg2.connect(dsn)
    models = find_active_models(conn, args.region)
    if not models:
        log.warning(f'No active lstm_aqi_24h model for region={args.region or "any"}')
        return

    for region, artifact_path in models:
        log.info(f'=== Forecast region={region or "global"} ===')
        try:
            run_forecast(conn, region, artifact_path)
        except Exception as exc:
            log.exception(f'Forecast fail for {region}: {exc}')

    # Cleanup old forecasts (>48h)
    with conn.cursor() as cur:
        cur.execute('SELECT public.cleanup_old_forecasts()')
    conn.commit()
    conn.close()
    log.info('Done.')


if __name__ == '__main__':
    main()
