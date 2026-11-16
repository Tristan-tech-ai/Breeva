import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from validate_humidity import barkjohn, daily, epa  # noqa: E402


def test_barkjohn_equation_10():
    # 0.524 * 20 - 0.0862 * 60 + 5.75 = 10.48 - 5.172 + 5.75
    assert abs(barkjohn(np.array([20.0]), np.array([60.0]))[0] - 11.058) < 1e-9
    assert barkjohn(np.array([0.0]), np.array([95.0]))[0] == 0.0  # negatives clipped


def test_epa_metrics_on_a_known_line():
    o = np.linspace(5, 50, 40)
    m = epa(1.2 * o + 2.0, o)
    assert abs(m["slope"] - 1.2) < 1e-6 and abs(m["intercept"] - 2.0) < 1e-6 and m["r_squared"] > 0.999
    e = 0.2 * o + 2.0
    assert abs(m["nrmse_pct"] - round(100 * np.sqrt(np.mean(e ** 2)) / o.mean(), 1)) < 1e-9
    assert m["passed"] == int(m["nrmse_pct"] <= 30) + 3  # R2, slope 1.2 and intercept 2 are inside the targets
    assert epa(2.0 * o, o)["passed"] < 4  # slope 2 fails


def test_daily_needs_18_hours_in_wita():
    idx = pd.date_range("2026-06-01T16:00:00Z", periods=48, freq="h")  # 00:00 WITA on 2 June
    M = np.ones((48, 1)); M[30:, 0] = np.nan  # second day has only 6 hours
    d = daily(M, idx)
    assert d.iloc[0, 0] == 1.0 and np.isnan(d.iloc[1, 0])
