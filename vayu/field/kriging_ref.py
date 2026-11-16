"""Reference values for the TypeScript kriging port (scripts/field/kriging.ts).

pair_stats, fit_vario and ok_predict below are the functions of the proposal's analysis H (sumber_proposal/analisis_h.py),
with the sensor count and distance matrix passed in instead of read from module globals. Running this file writes
tests/fixtures/kriging_ref.json: a small synthetic network (seeded), its distance matrix, the fitted variograms (all
sensors and leave-one-out) and the leave-one-out predictions, which tests/field-kriging.test.ts compares against.

    vayu/.venv/Scripts/python vayu/field/kriging_ref.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from scipy.optimize import nnls


def pair_stats(M, N, min_common=300):
    G = np.full((N, N), np.nan); W = np.zeros((N, N))
    for i in range(N):
        for j in range(i + 1, N):
            m = np.isfinite(M[:, i]) & np.isfinite(M[:, j])
            if m.sum() >= min_common:
                G[i, j] = G[j, i] = 0.5 * float(np.mean((M[m, i] - M[m, j]) ** 2))
                W[i, j] = W[j, i] = m.sum()
    return G, W


def fit_vario(G, W, DIST, skip=None):
    N = len(G)
    iu = np.triu_indices(N, 1)
    ok = np.isfinite(G[iu])
    if skip is not None:
        ok &= (iu[0] != skip) & (iu[1] != skip)
    d = DIST[iu][ok]; g = G[iu][ok]; w = np.sqrt(W[iu][ok])
    best = None
    for Lr in np.logspace(-0.5, 1.9, 40):
        A = np.column_stack([np.ones_like(d), 1 - np.exp(-d / Lr)]) * w[:, None]
        coef, res = nnls(A, g * w)
        if best is None or res < best[0]:
            best = (res, coef[0], coef[1], Lr)
    return best[1], best[2], best[3]


def ok_predict(M, i, params, dist):
    N = M.shape[1]
    c0_, c1_, L_ = params
    oth = np.array([j for j in range(N) if j != i])
    C = c1_ * np.exp(-dist[np.ix_(oth, oth)] / L_) + c0_ * np.eye(len(oth))
    c = c1_ * np.exp(-dist[oth, i] / L_)
    A = M[:, oth]
    ok = np.isfinite(A)
    pred = np.full(M.shape[0], np.nan)
    key = np.packbits(ok, axis=1)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    for u in np.unique(inv):
        rows = np.where(inv == u)[0]
        idx = np.where(ok[rows[0]])[0]
        if len(idx) == 0:
            continue
        k = len(idx)
        S = np.zeros((k + 1, k + 1)); S[:k, :k] = C[np.ix_(idx, idx)]; S[:k, k] = 1; S[k, :k] = 1
        rhs = np.append(c[idx], 1.0)
        try:
            w = np.linalg.solve(S, rhs)[:k]
        except np.linalg.LinAlgError:
            w = np.full(k, 1.0 / k)
        pred[rows] = A[np.ix_(rows, idx)] @ w
    return pred


def synthetic(seed=11, n=7, hours=500):
    rng = np.random.default_rng(seed)
    xy = rng.uniform(0, 30, size=(n, 2))
    dist = np.sqrt(((xy[:, None, :] - xy[None, :, :]) ** 2).sum(-1))
    common = rng.normal(3.2, 0.5, size=hours)
    cov = 0.2 * np.exp(-dist / 12.0)
    field = rng.multivariate_normal(np.zeros(n), cov, size=hours)
    Y = common[:, None] + field + rng.normal(0, 0.15, size=(hours, n))
    Y[rng.random((hours, n)) < 0.15] = np.nan  # missing hours
    Y[:120, 3] = np.nan  # one sensor starts late
    return Y, dist


def main():
    Y, dist = synthetic()
    N = Y.shape[1]
    G, W = pair_stats(Y, N)
    full = fit_vario(G, W, dist)
    loo = []
    for i in range(N):
        par = fit_vario(G, W, dist, skip=i)
        pred = ok_predict(Y, i, par, dist)
        loo.append({"variogram": list(map(float, par)), "pred": [None if not np.isfinite(x) else float(x) for x in pred]})
    out = {
        "Y": [[None if not np.isfinite(x) else float(x) for x in row] for row in Y.T],  # sensor-major
        "dist": dist.tolist(),
        "G": [[None if not np.isfinite(x) else float(x) for x in row] for row in G], "W": W.tolist(),
        "variogram": list(map(float, full)), "loo": loo,
    }
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "tests", "fixtures", "kriging_ref.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print("wrote", os.path.normpath(path), "variogram", full)


if __name__ == "__main__":
    main()
