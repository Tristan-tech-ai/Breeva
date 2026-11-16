"""Task F5-01: does the US-wide humidity correction help the Bali citizen sensors?

Correction (Barkjohn et al. 2021, AMT 14, 4617, Eq. 10, read from the paper 16 Nov 2026):
    PM2.5 = 0.524 * PA_cf1 - 0.0862 * RH + 5.75          (RH in %, the sensor's own humidity; negatives set to 0)
Developed for PurpleAir (Plantower PMS5003 cf_1, 24 h averages, reference median about 7 and maximum 109 ug/m3).
AirGradient monitors carry the same PM module; whether OpenAQ receives cf_1, atm or corrected values is not documented
(checked AirGradient's correction page and OpenAQ help, 16 Nov 2026), so this is tested, not assumed.

Two tests, daily means (WITA, >= 18 h), EPA sensor targets (NRMSE <= 30 %, R2 >= 0.70, slope 1 +- 0.35, intercept +- 5):
  A  leave-one-sensor-out log kriging among the 28 sensors (estimator ok_log of analysis H), raw vs corrected;
  B  the sensor network against the archive stations of Bali (daily network median vs station median), raw vs corrected:
     a change of level, which A cannot see.
RH: the sensor's own RH from OpenAQ where it reports one, else ERA5 relative_humidity_2m (Open-Meteo archive).

    vayu/.venv/Scripts/python vayu/field/validate_humidity.py --data <sumber_proposal/data> --out D:/breeva-ml-data/field/validation
OPENAQ_API_KEY is read from the environment or from --env-file, never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kriging_ref import fit_vario, ok_predict, pair_stats  # noqa: E402

FROM, TO = "2026-05-17T00:00:00Z", "2026-10-15T00:00:00Z"


def barkjohn(pm, rh):
    return np.maximum(0.0, 0.524 * pm - 0.0862 * rh + 5.75)


def key_from(env_file: str | None) -> str:
    k = os.environ.get("OPENAQ_API_KEY", "")
    if not k and env_file:
        for line in open(env_file, encoding="utf-8"):
            if line.startswith("OPENAQ_API_KEY="):
                k = line.split("=", 1)[1].strip().strip('"')
    return k


def openaq_rh(B: pd.DataFrame, key: str, cache: str) -> pd.DataFrame:
    if os.path.exists(cache):
        return pd.read_csv(cache, parse_dates=["th"])
    H = {"X-API-Key": key}

    def get(path, **params):
        for _ in range(8):
            r = requests.get("https://api.openaq.org/v3" + path, headers=H, params=params, timeout=90)
            if r.status_code == 200:
                return r.json()
            time.sleep(30 if r.status_code == 429 else 5)
        return {"results": []}

    rows = []
    for loc in B.loc_id:
        L = get(f"/locations/{int(loc)}")["results"]
        sens = [s for s in (L[0]["sensors"] if L else []) if s["parameter"]["name"] == "relativehumidity"]
        time.sleep(1.05)
        if not sens:
            continue
        page = 1
        while True:
            js = get(f"/sensors/{sens[0]['id']}/hours", datetime_from=FROM, datetime_to=TO, limit=1000, page=page)
            res = js.get("results", [])
            rows += [(int(loc), q["period"]["datetimeFrom"]["utc"], q["value"]) for q in res]
            time.sleep(1.05)
            if len(res) < 1000:
                break
            page += 1
    df = pd.DataFrame(rows, columns=["loc_id", "th", "rh"])
    df["th"] = pd.to_datetime(df.th, utc=True)
    df.to_csv(cache, index=False)
    return df


def era5_rh(B: pd.DataFrame, cache: str) -> pd.DataFrame:
    if os.path.exists(cache):
        return pd.read_csv(cache, parse_dates=["th"])
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
        "latitude": ",".join("%.4f" % v for v in B.lat), "longitude": ",".join("%.4f" % v for v in B.lon),
        "hourly": "relative_humidity_2m", "start_date": FROM[:10], "end_date": "2026-10-14", "timezone": "GMT"}, timeout=180)
    r.raise_for_status()
    js = r.json()
    js = js if isinstance(js, list) else [js]
    fr = []
    for loc, j in zip(B.loc_id, js):
        f = pd.DataFrame({"th": pd.to_datetime(j["hourly"]["time"], utc=True), "rh": j["hourly"]["relative_humidity_2m"]})
        f["loc_id"] = int(loc)
        fr.append(f)
    df = pd.concat(fr, ignore_index=True)
    df.to_csv(cache, index=False)
    return df


def daily(M, index):
    d = pd.DataFrame(M, index=index + pd.Timedelta(hours=8))
    c = d.notna().resample("D").sum()
    return d.resample("D").mean().where(c >= 18)


def epa(p, o):
    m = np.isfinite(p) & np.isfinite(o)
    p, o = p[m], o[m]
    e = p - o
    slope, icpt = np.polyfit(o, p, 1)
    r = np.corrcoef(p, o)[0, 1]
    res = {"n": int(m.sum()), "mean_obs": round(float(o.mean()), 2), "mean_pred": round(float(p.mean()), 2),
           "rmse": round(float(np.sqrt(np.mean(e ** 2))), 2), "nrmse_pct": round(float(100 * np.sqrt(np.mean(e ** 2)) / o.mean()), 1),
           "r_squared": round(float(r * r), 3), "slope": round(float(slope), 3), "intercept": round(float(icpt), 2)}
    res["passed"] = int(res["nrmse_pct"] <= 30) + int(res["r_squared"] >= 0.7) + int(abs(res["slope"] - 1) <= 0.35) + int(abs(res["intercept"]) <= 5)
    return res


def loso(V, dist):
    N = V.shape[1]
    Y = np.log1p(V)
    G, W = pair_stats(Y, N)
    P = np.full_like(V, np.nan)
    for i in range(N):
        P[:, i] = np.expm1(ok_predict(Y, i, fit_vario(G, W, dist, skip=i), dist))
    return np.where(np.isfinite(V), P, np.nan)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="C:/Users/Tristan/Downloads/teknopak/sumber_proposal/data")
    ap.add_argument("--out", default="D:/breeva-ml-data/field/validation")
    ap.add_argument("--env-file")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    B = pd.read_csv(os.path.join(a.data, "sensor_warga_bali.csv"))
    H = pd.read_csv(os.path.join(a.data, "openaq_jam.csv.gz"))
    H["th"] = pd.to_datetime(H.th, utc=True)
    H = H[(H.pm25 >= 0) & (H.pm25 < 1000) & H.loc_id.isin(B.loc_id)].drop_duplicates(["loc_id", "th"])
    P = H.pivot(index="th", columns="loc_id", values="pm25")
    ids = list(P.columns)
    B = B.set_index("loc_id").loc[ids].reset_index()
    V = P.values.astype(float)

    rh_s = openaq_rh(B, key_from(a.env_file), os.path.join(a.out, "openaq_rh_bali.csv.gz"))
    rh_e = era5_rh(B, os.path.join(a.out, "era5_rh_bali.csv.gz"))
    RS = rh_s[(rh_s.rh >= 0) & (rh_s.rh <= 100)].drop_duplicates(["loc_id", "th"]).pivot(index="th", columns="loc_id", values="rh").reindex(index=P.index, columns=ids)
    RE = rh_e.drop_duplicates(["loc_id", "th"]).pivot(index="th", columns="loc_id", values="rh").reindex(index=P.index, columns=ids)
    RH = RS.values.copy()
    use_era5 = ~np.isfinite(RH)
    RH[use_era5] = RE.values[use_era5]
    have = np.isfinite(V)
    variants = {"raw": V, "barkjohn_sensor_rh_else_era5": np.where(np.isfinite(RH), barkjohn(V, RH), np.nan),
                "barkjohn_era5_rh": np.where(np.isfinite(RE.values), barkjohn(V, RE.values), np.nan)}
    lat0 = np.radians(B.lat.mean())
    xy = np.column_stack([B.lon.values * 111.32 * np.cos(lat0), B.lat.values * 110.574])
    dist = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))

    X = pd.read_csv(os.path.join(a.data, "X_eksperimen.csv.gz"), usecols=["station_uid", "region", "th", "pm25"])
    X["th"] = pd.to_datetime(X.th, utc=True)
    xb = X[X.region == "bali"].pivot_table(index="th", columns="station_uid", values="pm25")
    ref_d = daily(xb.median(axis=1).to_frame().values, xb.index).iloc[:, 0]

    out = {"formula": "Barkjohn et al. 2021 Eq. 10: 0.524*PA_cf1 - 0.0862*RH + 5.75, negatives to 0",
           "rh": {"sensor_hours_with_own_rh_pct": round(float(100 * (np.isfinite(RS.values) & have).sum() / have.sum()), 1),
                  "sensors_with_own_rh": int(np.isfinite(RS.values).any(axis=0).sum()),
                  "median_rh_sensor": round(float(np.nanmedian(RS.values[have])), 1) if np.isfinite(RS.values[have]).any() else None,
                  "median_rh_era5": round(float(np.nanmedian(RE.values[have])), 1)},
           "hours_above_60_pct": round(float(100 * (V[have] > 60).mean()), 2), "hours_above_109_pct": round(float(100 * (V[have] > 109).mean()), 2),
           "A_loso_daily": {}, "B_network_vs_archive_daily": {}}
    for k, M in variants.items():
        M = np.where(have, M, np.nan)
        pred = loso(M, dist)
        out["A_loso_daily"][k] = epa(daily(pred, P.index).values.ravel(), daily(M, P.index).values.ravel())
        net = daily(pd.DataFrame(M, index=P.index).median(axis=1).to_frame().values, P.index).iloc[:, 0]
        j = pd.concat([net.rename("net"), ref_d.rename("ref")], axis=1).dropna()
        out["B_network_vs_archive_daily"][k] = epa(j.net.values, j.ref.values)
        print(k, "A", out["A_loso_daily"][k], "| B", out["B_network_vs_archive_daily"][k], flush=True)
    json.dump(out, open(os.path.join(a.out, "humidity_correction_bali.json"), "w"), indent=1)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
