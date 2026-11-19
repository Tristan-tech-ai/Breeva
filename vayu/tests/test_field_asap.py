"""F5-35: the dead-sensor screen and the hour rule used to re-check the smoke-hour visibility estimate."""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from analisis_asap_f535 import dead_sensors, hour_table  # noqa: E402


def test_dead_sensor_reads_zero_in_nine_of_ten_hours():
    pm = pd.DataFrame({
        "loc_id": [1] * 10 + [2] * 10 + [3] * 10,
        "pm25": [0.0] * 10 + [0.0] * 9 + [12.0] + [0.0] * 4 + [20.0] * 6,
    })
    dead, zero = dead_sensors(pm)
    assert dead == [1, 2]  # always 0, and 0 in 90% of hours
    assert round(zero[3], 2) == 0.4  # a sensor with some zero hours is kept


def _met(rows):
    return pd.DataFrame(rows, columns=["station", "valid", "lon", "lat", "vsby", "relh", "wxcodes"])


def test_rule_b_drops_smoke_hours_with_mist_and_keeps_dry_smoke():
    met = _met([
        ["WIPP", "2026-10-15 00:00", 104.7, -2.9, 0.6, 85.0, "FU"],      # smoke, no droplets: both rules fire
        ["WIPP", "2026-10-15 01:00", 104.7, -2.9, 0.6, 96.0, "FU BR"],   # smoke with mist: only rule A fires
        ["WIPP", "2026-10-15 02:00", 104.7, -2.9, 1.2, 60.0, "HZ"],      # dry and below 3 km: dry-low, both fire
        ["WIPP", "2026-10-15 03:00", 104.7, -2.9, 1.2, 60.0, "RA"],      # rain: neither
    ])
    h = hour_table(met).set_index("hour")
    assert h["fires_A"].tolist() == [True, True, True, False]
    assert h["fires_B"].tolist() == [True, False, True, False]
    # Koschmieder as smoke.ts: b = 3.912 / V, dried with (1 - RH)^0.6, PM = b_dry / (alpha / 1000)
    v = 0.6 * 1.609344
    assert abs(h["kosch"].iloc[0] - (3.912 / v) * (1 - 0.85) ** 0.6 / (6.2 / 1000)) < 1e-6
