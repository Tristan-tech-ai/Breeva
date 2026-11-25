"""Lambda handler of breeva-cctv (tasks N-33 and N-35, AWS Jakarta ap-southeast-3): every 20 minutes one frame per open
camera, counted in memory (hitung.py), and only numbers written:

  private bucket   hitung/<YYYY-MM-DD>/<HHMM>.json   one run (UTC), kept 30 days by the bucket lifecycle
                   hitung/terbaru.json               the latest run
                   hitung/riwayat.json               per camera the totals of the last 72 runs (24 hours)
  public CDN       v/nasional/cctv.json              camera points and the vehicle density index for /pantau

The camera list (id, city, stream URL, position) is the private object kamera.json in the same bucket; nothing written
carries a stream URL or a picture. After MATI_UTC (6 Dec 2026 00.00 WIB) the function does nothing, as a second switch
behind the schedule's EndDate.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from statistics import median

MATI_UTC = os.environ.get("MATI_UTC", "2026-12-05T17:00:00Z")
MODEL = os.environ.get("MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "yolox_s.onnx"))
NAMA_MODEL = "YOLOX-s ONNX (Apache-2.0, Megvii 0.1.1rc0), skor >= 0.3, satu bingkai per kamera"
LABEL = "uji coba selama lomba, izin tertulis sedang diproses"
RIWAYAT_N = 72  # 24 hours of 20-minute runs
INDEKS_MIN = 9  # runs (3 hours) before a camera has its own typical level
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


def _k(c: dict) -> str:
    return f'{c["kota"]}:{c["id"]}'


def perbarui_riwayat(riwayat: dict, run: dict, n: int = RIWAYAT_N) -> dict:
    """Per camera the totals of the last n runs, None where the camera was offline or blurred."""
    return {_k(h): (riwayat.get(_k(h), []) + [h.get("total") if h["status"] == "ok" else None])[-n:] for h in run["hasil"]}


def tingkat(indeks: float | None) -> str | None:
    if indeks is None:
        return None
    return "sepi" if indeks < 0.7 else "padat" if indeks > 1.3 else "biasa"


def ringkas_publik(kamera: list[dict], run: dict, riwayat: dict) -> dict:
    """The public file: per camera its point, name, state, vehicles in the latest frame, the mean of the last hour
    (3 runs) and that mean divided by the camera's own median of the last 24 hours (once it has INDEKS_MIN runs)."""
    hasil = {_k(h): h for h in run["hasil"]}
    rows = []
    for c in kamera:
        k = _k(c)
        h = hasil.get(k, {"status": "offline"})
        semua = [x for x in riwayat.get(k, []) if x is not None]
        jam = [x for x in riwayat.get(k, [])[-3:] if x is not None]
        rata = round(sum(jam) / len(jam), 1) if jam else None
        med = median(semua) if len(semua) >= INDEKS_MIN else None
        indeks = round(rata / med, 2) if rata is not None and med else None
        rows.append({"id": c["id"], "kota": c["kota"], "nama": c.get("nama", ""), "lat": c["lat"], "lon": c["lon"],
                     "status": h["status"], "total": h.get("total"), "rata_jam": rata, "indeks": indeks, "tingkat": tingkat(indeks)})
    return {
        "format": "cctv_publik", "updated_at": run["waktu_utc"], "label": LABEL, "model": run["model"],
        "catatan": ("Jumlah kendaraan yang terlihat pada satu bingkai per kamera tiap 20 menit, dihitung di memori; gambar "
                    "tidak disimpan. Indeks = rata-rata jam terakhir dibagi median 24 jam kamera itu. Belum masuk angka peta "
                    "(belum lolos uji lokasi disembunyikan)."),
        "kamera": rows,
    }


def tulis(s3, bucket: str, key: str, obj: dict, cache: str) -> None:
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json", CacheControl=cache)


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
    try:
        riwayat = json.loads(s3.get_object(Bucket=bucket, Key="hitung/riwayat.json")["Body"].read())
    except s3.exceptions.NoSuchKey:
        riwayat = {}
    riwayat = perbarui_riwayat(riwayat, run)
    for key in (kunci(now), "hitung/terbaru.json"):
        tulis(s3, bucket, key, run, "no-cache")
    tulis(s3, bucket, "hitung/riwayat.json", riwayat, "no-cache")
    publik = os.environ.get("PUBLIK_BUCKET")
    if publik:
        s3p = boto3.client("s3", region_name=os.environ.get("PUBLIK_REGION", "ap-southeast-1"))
        tulis(s3p, publik, "v/nasional/cctv.json", ringkas_publik(kamera, run, riwayat), "public, max-age=300")
    ringkas = {"key": kunci(now), "kamera": run["kamera"], "berhasil": run["berhasil"], "buram": run["buram"], "detik": run["detik"]}
    print(json.dumps(ringkas))
    return ringkas
