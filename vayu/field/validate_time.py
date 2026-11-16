"""Task F5-02: are the accuracy numbers of the proposal held up in months the models never saw?

Train on 17 May - 31 Aug 2026, test on 1 Sep - 14 Oct 2026, against random splits of the same data (which let a model
see hours next to the test hours, so they show how much autocorrelation flatters a number).

  A  cross-city calibration (analysis F estimator lin_dasar: Huber regression of log1p PM2.5 on log CAMS daily and
     hourly, hour of day, weekend), hourly RMSE per region, four designs:
       random      random 80/20 split of all rows (all cities in training)
       loco        leave one city out, all months (the proposal's number, stats_f.json E2 lin_dasar)
       time        all cities, train May-Aug, test Sep-Oct
       time_loco   the city held out AND only May-Aug in training, test that city in Sep-Oct (strictest)
  B  Bali citizen-sensor kriging (analysis H estimator ok_log), daily EPA metrics on Sep-Oct sensor-days:
       variogram fitted on May-Aug pairs only, versus fitted on all months, versus on a random half of the hours.

    vayu/.venv/Scripts/python vayu/field/validate_time.py [--data <sumber_proposal/data>] [--out D:/breeva-ml-data/field/validation]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import HuberRegressor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kriging_ref import fit_vario, ok_predict, pair_stats  # noqa: E402
from validate_humidity import daily, epa  # noqa: E402

SPLIT = pd.Timestamp("2026-09-01", tz="UTC")
FEATS = ["l_cams", "l_cams_jam", "jam_sin", "jam_cos", "akhir_pekan"]


def fit_predict(Xtr, ytr, Xte):
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
    m = HuberRegressor(alpha=1.0, epsilon=1.5, max_iter=400)
    m.fit((Xtr - mu) / sd, np.log1p(ytr))
    return np.expm1(m.predict((Xte - mu) / sd))


def rmse(p, o):
    m = np.isfinite(p) & np.isfinite(o)
    return round(float(np.sqrt(np.mean((p[m] - o[m]) ** 2))), 2) if m.any() else None


def calibration(data: str) -> dict:
    X = pd.read_csv(os.path.join(data, "X_eksperimen.csv.gz"),
                    usecols=["station_uid", "region", "th", "pm25", "cams_pm25", "cams_pm25_24j", "jam_sin", "jam_cos", "akhir_pekan"])
    X["th"] = pd.to_datetime(X.th, utc=True)
    X["l_cams"] = np.log1p(X.cams_pm25_24j.fillna(X.cams_pm25))
    X["l_cams_jam"] = np.log1p(X.cams_pm25)
    X = X.dropna(subset=FEATS + ["pm25"]).reset_index(drop=True)
    A, y, reg = X[FEATS].values, X.pm25.values, X.region.values
    late = (X.th >= SPLIT).values
    regions = sorted(X.region.unique())
    out = {"rows": int(len(X)), "test_rows_sep_oct": int(late.sum()), "per_region": {}}
    rng = np.random.default_rng(0)
    rand_test = rng.random(len(X)) < 0.2
    p_rand = np.full(len(X), np.nan)
    p_rand[rand_test] = fit_predict(A[~rand_test], y[~rand_test], A[rand_test])
    p_time = np.full(len(X), np.nan)
    p_time[late] = fit_predict(A[~late], y[~late], A[late])
    p_loco = np.full(len(X), np.nan)
    p_tl = np.full(len(X), np.nan)
    for r in regions:
        te = reg == r
        p_loco[te] = fit_predict(A[~te], y[~te], A[te])
        tr = (~te) & (~late)
        sel = te & late
        if sel.any():
            p_tl[sel] = fit_predict(A[tr], y[tr], A[sel])
    cams = X.cams_pm25.values.astype(float)
    for r in regions:
        te = reg == r
        out["per_region"][r] = {
            "random": rmse(p_rand[te & rand_test], y[te & rand_test]),
            "loco_all_months": rmse(p_loco[te], y[te]),
            "loco_sep_oct": rmse(p_loco[te & late], y[te & late]),
            "time": rmse(p_time[te & late], y[te & late]),
            "time_loco": rmse(p_tl[te & late], y[te & late]),
            "cams_sep_oct": rmse(cams[te & late], y[te & late]),
            "n_sep_oct": int((te & late).sum()),
        }
    out["all"] = {
        "random": rmse(p_rand[rand_test], y[rand_test]), "loco_all_months": rmse(p_loco, y),
        "loco_sep_oct": rmse(p_loco[late], y[late]), "time": rmse(p_time[late], y[late]),
        "time_loco": rmse(p_tl[late], y[late]), "cams_sep_oct": rmse(cams[late], y[late]),
    }
    npal = reg != "palembang"
    out["all_without_palembang"] = {
        "loco_sep_oct": rmse(p_loco[late & npal], y[late & npal]), "time_loco": rmse(p_tl[late & npal], y[late & npal]),
        "cams_sep_oct": rmse(cams[late & npal], y[late & npal]),
    }
    return out


def kriging(data: str) -> dict:
    B = pd.read_csv(os.path.join(data, "sensor_warga_bali.csv"))
    H = pd.read_csv(os.path.join(data, "openaq_jam.csv.gz"))
    H["th"] = pd.to_datetime(H.th, utc=True)
    H = H[(H.pm25 >= 0) & (H.pm25 < 1000) & H.loc_id.isin(B.loc_id)].drop_duplicates(["loc_id", "th"])
    P = H.pivot(index="th", columns="loc_id", values="pm25")
    ids = list(P.columns)
    B = B.set_index("loc_id").loc[ids].reset_index()
    V = P.values.astype(float)
    Y = np.log1p(V)
    N = V.shape[1]
    lat0 = np.radians(B.lat.mean())
    xy = np.column_stack([B.lon.values * 111.32 * np.cos(lat0), B.lat.values * 110.574])
    dist = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))
    late = (P.index >= SPLIT)
    rng = np.random.default_rng(1)
    half = rng.random(len(P)) < 0.5
    fits = {"fit_may_aug": Y[~late], "fit_all_months": Y, "fit_random_half": Y[half]}
    out = {"sensors": N, "hours_sep_oct": int(late.sum())}
    obs_late = np.where(late[:, None], V, np.nan)
    for name, Yfit in fits.items():
        G, W = pair_stats(Yfit, N)
        Pr = np.full_like(V, np.nan)
        for i in range(N):
            Pr[:, i] = np.expm1(ok_predict(Y, i, fit_vario(G, W, dist, skip=i), dist))
        Pr = np.where(np.isfinite(obs_late), Pr, np.nan)
        out[name] = epa(daily(Pr, P.index).values.ravel(), daily(obs_late, P.index).values.ravel())
        out[name]["variogram_all_sensors"] = [round(float(x), 4) for x in fit_vario(G, W, dist)]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data")
    ap.add_argument("--out", default="D:/breeva-ml-data/field/validation")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    rep = {"split": str(SPLIT.date()), "calibration": calibration(a.data), "kriging_bali": kriging(a.data)}
    json.dump(rep, open(os.path.join(a.out, "time_split.json"), "w"), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
