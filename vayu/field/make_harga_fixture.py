"""Writes tests/fixtures/harga_small.bin and harga_small.json so the TypeScript reader (src/lib/field/harga.ts) is tested
against the Python writer (harga_hirup.write_client)."""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from harga_hirup import read_client, write_client  # noqa: E402

out = os.path.join(HERE, "..", "..", "tests", "fixtures")
rng = np.random.default_rng(4)
h = np.round(rng.lognormal(0, 0.8, 50), 3)
c = np.sort(rng.integers(0, 4, 50))
path = os.path.join(out, "harga_small.bin")
write_client(path, h, c, 4, {"geometry": "test", "name": "harga_small"})
meta, back = read_client(path)
rows = []
for k in range(len(h)):
    cc = int(c[k])
    rows.append({"c": cc, "i": int(k - meta["cell_offsets"][cc]), "h": float(back[k])})
json.dump({"meta": meta, "rows": rows}, open(os.path.join(out, "harga_small.json"), "w"))
print("fixture", len(h), os.path.getsize(path))
