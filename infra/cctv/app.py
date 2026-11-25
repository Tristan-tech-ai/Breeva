"""Lambda handler of breeva-cctv (task N-33, AWS Jakarta ap-southeast-3): every 20 minutes one frame per open camera,
counted in memory (hitung.py), and only the counts written to the private bucket:

  hitung/<YYYY-MM-DD>/<HHMM>.json   one run (UTC), kept 30 days by the bucket lifecycle
  hitung/terbaru.json               the latest run

The camera list (id, city, stream URL, position) is the private object kamera.json in the same bucket; the output carries
no stream URL and no picture. After MATI_UTC (6 Dec 2026 00.00 WIB) the function does nothing, as a second switch behind
the schedule's EndDate.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

MATI_UTC = os.environ.get("MATI_UTC", "2026-12-05T17:00:00Z")
MODEL = os.environ.get("MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "yolox_s.onnx"))
NAMA_MODEL = "YOLOX-s ONNX (Apache-2.0, Megvii 0.1.1rc0), skor >= 0.3, satu bingkai per kamera"
_penghitung = None


def sudah_mati(now: datetime, mati_utc: str = MATI_UTC) -> bool:
    return now >= datetime.fromisoformat(mati_utc.replace("Z", "+00:00"))


def kunci(now: datetime) -> str:
    return f"hitung/{now:%Y-%m-%d}/{now:%H%M}.json"


def tanpa_rahasia(run: dict) -> dict:
    """The run as written: per camera only id, city, state, sharpness and counts (a guard against a future field
    carrying the stream URL or pixels into S3)."""
    boleh = {"id", "kota", "status", "tajam", "mobil", "motor", "bus", "truk", "total"}
    return {**run, "hasil": [{k: v for k, v in h.items() if k in boleh} for h in run["hasil"]]}


def handler(event, context):
    now = datetime.now(timezone.utc)
    if sudah_mati(now):
        print(json.dumps({"status": "mati", "mati_utc": MATI_UTC}))
        return {"status": "mati"}
    import boto3

    from hitung import Penghitung, jalankan

    global _penghitung
    if _penghitung is None:
        _penghitung = Penghitung(MODEL)
    bucket = os.environ["BUCKET"]
    s3 = boto3.client("s3")
    kamera = json.loads(s3.get_object(Bucket=bucket, Key="kamera.json")["Body"].read())["kamera"]
    run = tanpa_rahasia(jalankan(kamera, _penghitung, paralel=int(os.environ.get("PARALEL", "16")), model=NAMA_MODEL))
    body = json.dumps(run, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    for key in (kunci(now), "hitung/terbaru.json"):
        s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json", CacheControl="no-cache")
    ringkas = {"key": kunci(now), "kamera": run["kamera"], "berhasil": run["berhasil"], "buram": run["buram"], "detik": run["detik"]}
    print(json.dumps(ringkas))
    return ringkas
