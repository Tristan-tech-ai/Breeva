import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "field"))
from validate_field import STEP, decode_cell  # noqa: E402

FIX = os.path.join(HERE, "..", "..", "tests", "fixtures")


def test_python_decoder_reads_the_typescript_encoder_output():
    buf = open(os.path.join(FIX, "cell_small.bin"), "rb").read()
    want = json.load(open(os.path.join(FIX, "cell_small.json"), encoding="utf-8"))
    d = decode_cell(buf)
    cap = {"pm25_delta": 12.75, "no2": 255, "no2_delta": 63.75, "pi_half": 62}
    conf = {"refuse": 0, "low": 1, "medium": 2, "high": 3}
    for k, v in enumerate(want):
        for col in ("pm25", "pm25_delta", "no2", "no2_delta", "pi_half"):
            w = v[col] if col == "pm25" else min(v[col], cap[col])
            assert abs(d[col][k] - w) <= STEP[col] / 2 + 1e-9, (k, col)
        assert int(d["confidence"][k]) == conf[v["confidence"]]
        assert bool(d["ood"][k]) == v["ood"]


def test_decoder_rejects_a_truncated_cell():
    buf = open(os.path.join(FIX, "cell_small.bin"), "rb").read()
    try:
        decode_cell(buf[:-1])
    except ValueError:
        return
    raise AssertionError("truncated cell accepted")
