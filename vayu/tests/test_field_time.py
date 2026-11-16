import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from validate_time import SPLIT, fit_predict, rmse  # noqa: E402


def test_split_date_and_rmse():
    assert str(SPLIT.date()) == "2026-09-01"
    assert rmse(np.array([1.0, 3.0, np.nan]), np.array([1.0, 1.0, 5.0])) == round(float(np.sqrt(2.0)), 2)
    assert rmse(np.array([np.nan]), np.array([1.0])) is None


def test_calibration_recovers_a_log_linear_relation_out_of_sample():
    rng = np.random.default_rng(0)
    x = rng.uniform(1, 4, size=(800, 1))
    y = np.expm1(0.5 + 0.8 * x[:, 0] + rng.normal(0, 0.05, 800))
    p = fit_predict(x[:600], y[:600], x[600:])
    assert np.sqrt(np.mean((p - y[600:]) ** 2)) / y[600:].mean() < 0.1
