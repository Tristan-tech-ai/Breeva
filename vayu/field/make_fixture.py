"""Writes tests/fixtures/pack_small.bin and pack_small.json so the TypeScript reader is tested against the Python writer."""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tests"))
from pack import Pack, write_pack  # noqa: E402
from test_field_pack import synthetic  # noqa: E402

out = os.path.join(HERE, "..", "..", "tests", "fixtures")
os.makedirs(out, exist_ok=True)
path = os.path.join(out, "pack_small.bin")
write_pack(path, synthetic(40, seed=11), "test", "bali", (115.0, -9.0, 115.5, -8.5))
p = Pack(path)
rows = []
for k in range(p.n):
    rows.append({
        "c": int(p.cols["c"][k]), "i": int(p.cols["i"][k]), "osm_way_id": int(p.cols["osm_way_id"][k]),
        "highway": p.highway(k), "coords": p.coords(k).tolist(), "neighbours": [int(x) for x in p.neighbours(k)],
        "lanes": None if np.isnan(p.cols["lanes"][k]) else float(p.cols["lanes"][k]),
        "name": p.string("name", k) or None,
    })
json.dump({"n": p.n, "rows": rows}, open(os.path.join(out, "pack_small.json"), "w", encoding="utf-8"), indent=0)
print("fixture", p.n, os.path.getsize(path))
