"""
Breeva v2 — export a SERVABLE static GP spatial-residual surface for live road-aqi.

The validated Layer-D GP (layer_d_gp.py) krigs per-(region,hour) on CURRENT sensor residuals
(real-time) and saves no servable model. For live serving without a real-time multi-sensor feed,
we krige each deployed region's per-sensor MEAN residual_abc over the window → a STATIC spatial
"systematic offset" surface μ_GP(x) that corrects the persistent under/over-estimate of A+B at
each location. Served in TS as: μ_GP(x*) = y_mean + y_std · Σ_i exp(-d(x*,Xi)²/2ℓ²)·alpha_i.

VALIDATE-FIRST (no-regret, esp. bali = demo): leave-one-sensor-out on the per-sensor means.
Deploy a region ONLY if LOSO improves vs GP=0 AND PI95 coverage ∈ [0.85, ~1.0]. Else honest GP=0.

Run: python vayu/calibration/export_gp_serving.py
"""
from __future__ import annotations
import json, math, sys
from pathlib import Path
import numpy as np, pandas as pd
import warnings
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, WhiteKernel
warnings.simplefilter('ignore', ConvergenceWarning)
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

HERE = Path(__file__).resolve().parent
IN_CSV = HERE / 'd3_residual_abc.csv'
OUT_JSON = HERE / 'gp_serving_params.json'
REGION_LS_KM = {'jakarta': 3.0, 'bali': 7.0, 'denpasar': 7.0, 'yogyakarta': 8.0}
DEFAULT_LS_KM = 10.0
NOISE = 8.0
CANDIDATE_REGIONS = ['jakarta', 'bali']   # priority; others stay GP=0
MIN_SENSORS = 5

def to_local_km(lat, lon, lat0, lon0):
    return ((lon - lon0) * 111.320 * math.cos(math.radians(lat0)), (lat - lat0) * 110.574)

def make_gp(region):
    ls = REGION_LS_KM.get(region, DEFAULT_LS_KM)
    k = RBF(ls, (0.5, 50.0)) + WhiteKernel(NOISE, (0.5, 60.0))
    return GaussianProcessRegressor(kernel=k, n_restarts_optimizer=2, normalize_y=True)

def rmse(a, b): return float(np.sqrt(np.mean((np.asarray(a, float) - np.asarray(b, float)) ** 2)))

def main() -> int:
    df = pd.read_csv(IN_CSV)
    out = {'layer': 'D_gp_serving_static', 'note': 'static per-sensor-mean residual_abc kriged; '
           'live offset μ_GP(x)=y_mean+y_std·Σ exp(-d²/2ℓ²)·alpha. LOSO-validated, per-region opt-in.',
           'regions': {}}
    print('\n' + '=' * 92)
    print('STATIC GP SERVING SURFACE — per-sensor mean residual_abc, LOSO validated (deploy if improves)')
    print('=' * 92)
    for region in CANDIDATE_REGIONS:
        g = df[df['region'] == region]
        if not len(g):
            print(f'{region:<10} no rows'); continue
        gg = g.groupby('sensor_uid', as_index=False).agg(lat=('lat','first'), lon=('lon','first'),
                                                          resid=('residual_abc','mean'))
        n = len(gg)
        if n < MIN_SENSORS:
            print(f'{region:<10} only {n} sensors (<{MIN_SENSORS}) → GP=0'); continue
        lat0, lon0 = float(gg['lat'].mean()), float(gg['lon'].mean())
        X = np.array([to_local_km(la, lo, lat0, lon0) for la, lo in zip(gg['lat'], gg['lon'])])
        y = gg['resid'].to_numpy(float)
        # LOSO validation on the per-sensor means
        oof = np.zeros(n); oof_std = np.zeros(n)
        for i in range(n):
            tr = np.arange(n) != i
            gp = make_gp(region); gp.fit(X[tr], y[tr])
            mu, sd = gp.predict(X[i:i+1], return_std=True)
            oof[i], oof_std[i] = mu[0], sd[0]
        base = rmse(y, 0.0); gpr = rmse(y, oof)
        cov = float(np.mean(np.abs(y - oof) <= 1.96 * oof_std))
        impr = (base - gpr) / base * 100 if base > 1e-9 else 0.0
        deploy = impr > 0 and 0.85 <= cov <= 1.0
        print(f'{region:<10} n={n:>3}  resid_mean={y.mean():+.2f}  no-GP RMSE {base:.2f} -> GP {gpr:.2f}  '
              f'impr {impr:+.1f}%  PI95cov {cov:.2f}  => {"DEPLOY" if deploy else "GP=0 (opt-out)"}')
        if not deploy:
            continue
        # Refit on ALL sensors for the deployable surface; export servable params.
        gp = make_gp(region); gp.fit(X, y)
        ls_fit = float(gp.kernel_.k1.length_scale)
        y_mean = float(gp._y_train_mean); y_std = float(gp._y_train_std)
        alpha = gp.alpha_.ravel().tolist()   # dual coefs in NORMALIZED y space
        out['regions'][region] = {
            'lat0': lat0, 'lon0': lon0, 'length_scale_km': round(ls_fit, 4),
            'y_mean': round(y_mean, 6), 'y_std': round(y_std, 6),
            'X_km': [[round(float(x), 5), round(float(yy), 5)] for x, yy in X],
            'alpha': [round(float(a), 8) for a in alpha],
            'n_sensors': n, 'loso_rmse_no_gp': round(base, 3), 'loso_rmse_gp': round(gpr, 3),
            'loso_improvement_pct': round(impr, 1), 'loso_pi95_cov': round(cov, 3),
            'resid_mean': round(float(y.mean()), 3),
        }
        # PARITY: sklearn.predict vs the TS serving formula at random nearby points.
        rng = np.random.default_rng(0)
        Xtest = X.mean(0) + rng.normal(0, 6, size=(30, 2))
        mu_sk = gp.predict(Xtest)
        al = np.asarray(alpha)
        mu_ts = np.array([y_mean + y_std * float(np.exp(-np.sum((X - xt) ** 2, axis=1) / (2 * ls_fit * ls_fit)) @ al)
                          for xt in Xtest])
        out['regions'][region]['ts_parity_max_abs'] = float(np.abs(mu_sk - mu_ts).max())
        print(f'  [{region}] PARITY sklearn-vs-TS max|Δ| over 30 pts = {np.abs(mu_sk - mu_ts).max():.2e}')
    OUT_JSON.write_text(json.dumps(out, indent=2), encoding='utf-8')
    print('-' * 92)
    print(f'deployable regions: {list(out["regions"].keys())} → wrote {OUT_JSON.name}')
    print('=' * 92 + '\n')
    # quick self-parity: reconstruct one prediction the TS way, compare to sklearn
    for region, p in out['regions'].items():
        Xk = np.array(p['X_km']); al = np.array(p['alpha']); ls = p['length_scale_km']
        x0 = Xk[0]
        d2 = np.sum((Xk - x0) ** 2, axis=1)
        k = np.exp(-d2 / (2 * ls * ls))
        mu_ts = p['y_mean'] + p['y_std'] * float(k @ al)
        gp = make_gp(region);
        Xall = np.array(p['X_km'])
        # rebuild y from params is not trivial; instead refit + predict to compare
        print(f'  [{region}] TS-formula μ_GP at sensor0 = {mu_ts:+.3f} (sanity: finite={np.isfinite(mu_ts)})')
    return 0

if __name__ == '__main__':
    sys.exit(main())
