"""
VAYU — XGBoost residual correction trainer (Phase 2.1).

Trains models that learn (ground_truth_pm25 - predicted_pm25) as a function of
predicted value + features. After training, the corrected prediction is:
    corrected = predicted + xgb_residual_prediction

Pipeline:
  1. Load (predicted_pm25, ground_truth_pm25, features) pairs from
     public.prediction_logs WHERE ground_truth_pm25 IS NOT NULL.
  2. Featurize: highway one-hot + canyon_ratio + traffic + congestion +
     time of day + day of week + Sentinel proxy.
  3. Train XGBoost regression (residual = y - predicted).
  4. Save artifact to models/caline3_residual_<region>_<version>.json.
  5. Optional: upload to Supabase Storage bucket `ml-models`.
  6. Register row in ml_model_registry (active=true, deactivate prior).
  7. Log run + metrics ke MLflow (http://127.0.0.1:8080).

Run:
    python vayu/ml/train_residual_xgboost.py --all-regions
    python vayu/ml/train_residual_xgboost.py --region jakarta --version v20260516
    python vayu/ml/train_residual_xgboost.py --upload-storage
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load .env.local
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
import pandas as pd
import psycopg2
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

try:
    import mlflow
    HAS_MLFLOW = True
except ImportError:
    HAS_MLFLOW = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('train_residual')

if HAS_MLFLOW:
    try:
        mlflow.set_tracking_uri(os.environ.get('MLFLOW_TRACKING_URI', 'http://127.0.0.1:8080'))
        mlflow.set_experiment('caline3_residual_correction')
    except Exception as exc:
        log.warning(f'MLflow setup failed (continuing without tracking): {exc}')
        HAS_MLFLOW = False


HIGHWAY_CLASSES = [
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'residential', 'living_street',
    'unclassified', 'service',
]


def load_training_data(conn, region: str | None) -> pd.DataFrame:
    where_region = f"AND pl.region = '{region}'" if region else ''
    sql = f"""
        SELECT
          pl.id,
          pl.region,
          pl.predicted_pm25,
          pl.ground_truth_pm25,
          pl.features,
          pl.predicted_at
        FROM public.prediction_logs pl
        WHERE pl.ground_truth_pm25 IS NOT NULL
          AND pl.ground_truth_distance_km < 5.0
          {where_region}
        ORDER BY pl.predicted_at DESC
        LIMIT 200000;
    """
    df = pd.read_sql(sql, conn)
    log.info(f'Loaded {len(df)} rows for region={region or "all"}')
    return df


def featurize(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, list[str]]:
    # JSONB features → flat columns
    feat_df = pd.json_normalize(df['features'].apply(lambda x: x if isinstance(x, dict) else {})).fillna(0)

    base = pd.DataFrame({
        'predicted_pm25': df['predicted_pm25'].astype(float),
    })

    # Highway one-hot (ensure all classes present)
    for hw in HIGHWAY_CLASSES:
        col = f'hw_{hw}'
        if col in feat_df.columns:
            base[col] = feat_df[col]
        else:
            base[col] = 0

    # Numeric features (extract from JSONB or default 0)
    for col in ['canyon_ratio', 'traffic_base_estimate', 'hour_of_day',
                'day_of_week', 'is_weekend', 'congestion_factor',
                'sentinel_pm25_proxy']:
        if col in feat_df.columns:
            base[col] = pd.to_numeric(feat_df[col], errors='coerce').fillna(0)
        else:
            base[col] = 0

    # Target: residual error = ground_truth - predicted
    y = (df['ground_truth_pm25'].astype(float) - df['predicted_pm25'].astype(float)).values
    X = base.values.astype(np.float32)
    return X, y, list(base.columns)


def train_one(df: pd.DataFrame, region: str | None, version: str,
              upload_storage: bool = False) -> dict:
    ctx = mlflow.start_run(run_name=f'residual_{region or "global"}_{version}') if HAS_MLFLOW else _noop_cm()
    with ctx:
        X, y, feature_names = featurize(df)
        if len(X) < 200:
            log.warning(f'Skip — only {len(X)} samples for {region or "global"}; need >=200')
            return {'skipped': True, 'n': len(X)}

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        if HAS_MLFLOW:
            mlflow.log_params({
                'region': region or 'global',
                'version': version,
                'n_train': len(X_train),
                'n_test': len(X_test),
                'n_features': len(feature_names),
            })

        params = {
            'objective': 'reg:squarederror',
            'eval_metric': 'mae',
            'max_depth': 6,
            'learning_rate': 0.05,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'tree_method': 'hist',
            'random_state': 42,
        }
        # Use CUDA if available (RTX 5060 Ti)
        try:
            import torch
            if torch.cuda.is_available():
                params['device'] = 'cuda'
        except ImportError:
            pass
        if HAS_MLFLOW:
            mlflow.log_params(params)

        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_names)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_names)
        booster = xgb.train(
            params, dtrain, num_boost_round=500,
            evals=[(dtrain, 'train'), (dtest, 'test')],
            early_stopping_rounds=20, verbose_eval=50,
        )

        # Evaluate residual prediction
        y_pred = booster.predict(dtest)
        original_predictions = X_test[:, feature_names.index('predicted_pm25')]
        ground_truth = original_predictions + y_test
        corrected = original_predictions + y_pred

        baseline_mae = float(mean_absolute_error(ground_truth, original_predictions))
        corrected_mae = float(mean_absolute_error(ground_truth, corrected))
        improvement_pct = (baseline_mae - corrected_mae) / max(baseline_mae, 1e-6) * 100

        metrics = {
            'baseline_mae': baseline_mae,
            'corrected_mae': corrected_mae,
            'corrected_rmse': float(np.sqrt(mean_squared_error(ground_truth, corrected))),
            'corrected_r2': float(r2_score(ground_truth, corrected)),
            'improvement_pct': float(improvement_pct),
            'n_train': len(X_train),
            'n_test': len(X_test),
        }
        if HAS_MLFLOW:
            mlflow.log_metrics(metrics)
        log.info(f'[{region or "global"}] baseline_mae={baseline_mae:.2f} corrected_mae={corrected_mae:.2f} ({improvement_pct:+.1f}%)')

        # Save artifact
        models_dir = Path('models')
        models_dir.mkdir(exist_ok=True)
        artifact_filename = f'caline3_residual_{region or "global"}_{version}.json'
        artifact_path = models_dir / artifact_filename
        booster.save_model(str(artifact_path))
        log.info(f'Saved {artifact_path}')

        if HAS_MLFLOW:
            try:
                mlflow.xgboost.log_model(booster, 'model')
            except Exception:
                pass

        artifact_url = None
        if upload_storage:
            artifact_url = upload_to_storage(artifact_path, artifact_filename)

        return {
            'skipped': False,
            'artifact_path': str(artifact_path),
            'artifact_url': artifact_url,
            'feature_names': feature_names,
            'metrics': metrics,
        }


def upload_to_storage(local_path: Path, dest_name: str) -> str | None:
    """Upload model JSON to Supabase Storage bucket `ml-models`, return public URL."""
    supabase_url = os.environ.get('SUPABASE_URL')
    service_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not supabase_url or not service_key:
        log.warning('SUPABASE_URL / SERVICE_ROLE_KEY missing; skip upload')
        return None
    try:
        import httpx
        with open(local_path, 'rb') as f:
            r = httpx.post(
                f'{supabase_url}/storage/v1/object/ml-models/{dest_name}',
                content=f.read(),
                headers={
                    'Authorization': f'Bearer {service_key}',
                    'apikey': service_key,
                    'Content-Type': 'application/json',
                    'x-upsert': 'true',
                },
                timeout=120,
            )
        if r.status_code in (200, 201):
            url = f'{supabase_url}/storage/v1/object/public/ml-models/{dest_name}'
            log.info(f'Uploaded to {url}')
            return url
        log.warning(f'Upload status {r.status_code}: {r.text[:200]}')
    except Exception as exc:
        log.warning(f'Upload failed: {exc}')
    return None


def register_model(conn, region: str | None, version: str, result: dict):
    sql_deactivate = "UPDATE public.ml_model_registry SET active = FALSE WHERE model_name = 'caline3_residual' AND region IS NOT DISTINCT FROM %s"
    sql_insert = """
        INSERT INTO public.ml_model_registry
          (model_name, version, region, artifact_url, artifact_path, metrics, features, active)
        VALUES ('caline3_residual', %s, %s, %s, %s, %s, %s, TRUE)
        ON CONFLICT (model_name, version, region) DO UPDATE SET
          artifact_url = EXCLUDED.artifact_url,
          artifact_path = EXCLUDED.artifact_path,
          metrics = EXCLUDED.metrics,
          features = EXCLUDED.features,
          active = TRUE,
          trained_at = NOW();
    """
    with conn.cursor() as cur:
        cur.execute(sql_deactivate, (region,))
        cur.execute(sql_insert, (
            version, region, result.get('artifact_url'), result.get('artifact_path'),
            json.dumps(result['metrics']), result['feature_names'],
        ))
    conn.commit()
    log.info(f'Registered model: caline3_residual {version} region={region or "global"}')


class _noop_cm:
    def __enter__(self): return self
    def __exit__(self, *a): return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region')
    parser.add_argument('--all-regions', action='store_true')
    parser.add_argument('--version', default=f'v{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")}')
    parser.add_argument('--upload-storage', action='store_true',
                        help='Upload artifact to Supabase Storage ml-models bucket')
    parser.add_argument('--min-rows', type=int, default=200,
                        help='Minimum rows required to train (per region)')
    args = parser.parse_args()

    dsn = os.environ.get('SUPABASE_POOLER_URL')
    if not dsn:
        log.error('SUPABASE_POOLER_URL not set')
        sys.exit(1)

    conn = psycopg2.connect(dsn)

    if args.all_regions:
        regions: list[str | None] = [
            None, 'jakarta', 'bali', 'bandung', 'surabaya',
            'semarang', 'yogyakarta', 'solo',
            'medan', 'palembang', 'makassar',
        ]
    elif args.region:
        regions = [args.region]
    else:
        regions = [None]

    for region in regions:
        log.info(f'=== Training region={region or "global"} ===')
        df = load_training_data(conn, region)
        if len(df) < args.min_rows:
            log.warning(f'Skip {region or "global"}: only {len(df)} rows (need {args.min_rows})')
            continue
        result = train_one(df, region, args.version, upload_storage=args.upload_storage)
        if result.get('skipped'):
            continue
        register_model(conn, region, args.version, result)

    conn.close()
    log.info('Done.')


if __name__ == '__main__':
    main()
