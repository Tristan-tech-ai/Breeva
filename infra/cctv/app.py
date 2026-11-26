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
from datetime import datetime, timedelta, timezone
from statistics import median

MATI_UTC = os.environ.get("MATI_UTC", "2026-12-05T17:00:00.000Z")  # the Scheduler EndDate format (milliseconds)
MODEL = os.environ.get("MODEL", os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "yolox_s.onnx"))
NAMA_MODEL = "YOLOX-s ONNX (Apache-2.0, Megvii 0.1.1rc0), skor >= 0.3, satu bingkai per kamera"
LABEL = "uji coba selama lomba, izin tertulis sedang diproses"
INDEKS_MIN = 3  # same-hour runs on earlier days before a camera has its own typical level
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


RIWAYAT_HARI = 8  # days of runs kept for the same-hour baseline


def perbarui_riwayat(riwayat: dict, run: dict, now: datetime, hari: int = RIWAYAT_HARI) -> dict:
    """History of runs: per run its time (UTC ISO) and per camera its total (None when offline or blurred), the last
    `hari` days. N-44: the index compares with the same hour on earlier days, so the history keeps the run times. A
    history in the old format (per camera a list without times) is dropped and rebuilt from the archive by the handler."""
    runs = riwayat.get("runs", []) if isinstance(riwayat.get("runs"), list) else []
    runs = runs + [{"t": now.strftime("%Y-%m-%dT%H:%MZ"), "v": {_k(h): (h.get("total") if h["status"] == "ok" else None) for h in run["hasil"]}}]
    batas = now - timedelta(days=hari)
    return {"format": "riwayat_v2", "runs": [r for r in runs if datetime.fromisoformat(r["t"].replace("Z", "+00:00")) >= batas]}


def tingkat(indeks: float | None) -> str | None:
    if indeks is None:
        return None
    return "sepi" if indeks < 0.7 else "padat" if indeks > 1.3 else "biasa"


def jam_wib(t: datetime) -> int:
    return (t + timedelta(hours=7)).hour


def run_jam_sama(riwayat: dict, now: datetime) -> list[dict]:
    """Runs of earlier days (at least 20 hours old) at the same WIB hour as now, plus and minus one hour."""
    h = jam_wib(now)
    out = []
    for r in riwayat.get("runs", []):
        t = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        d = abs(jam_wib(t) - h)
        if now - t >= timedelta(hours=20) and min(d, 24 - d) <= 1:
            out.append(r)
    return out


def dasar_jam(sama: list[dict], k: str, min_n: int = INDEKS_MIN) -> float | None:
    """The camera's typical count at this time of day: the median of its totals in `sama` (run_jam_sama), once there
    are `min_n` of them."""
    vals = [r["v"][k] for r in sama if r["v"].get(k) is not None]
    return median(vals) if len(vals) >= min_n else None


def ringkas_publik(kamera: list[dict], run: dict, riwayat: dict, now: datetime) -> dict:
    """The public file: per camera its point, name, state, vehicles in the latest frame, the mean of the last hour
    (3 runs) and that mean against the same hour on earlier days ((mean + 1) / (typical + 1), so a near-empty night road
    does not swing between extremes); no index before there is a same-hour baseline."""
    hasil = {_k(h): h for h in run["hasil"]}
    akhir = riwayat.get("runs", [])[-3:]
    sama = run_jam_sama(riwayat, now)
    rows = []
    for c in kamera:
        k = _k(c)
        h = hasil.get(k, {"status": "offline"})
        jam = [r["v"].get(k) for r in akhir if r["v"].get(k) is not None]
        rata = round(sum(jam) / len(jam), 1) if jam else None
        dasar = dasar_jam(sama, k)
        indeks = round((rata + 1) / (dasar + 1), 2) if rata is not None and dasar is not None else None
        rows.append({"id": c["id"], "kota": c["kota"], "nama": c.get("nama", ""), "lat": c["lat"], "lon": c["lon"],
                     "status": h["status"], "total": h.get("total"), "rata_jam": rata, "biasa_jam_ini": round(dasar, 1) if dasar is not None else None,
                     "indeks": indeks, "tingkat": tingkat(indeks)})
    return {
        "format": "cctv_publik", "updated_at": run["waktu_utc"], "label": LABEL, "model": run["model"],
        "catatan": ("Jumlah kendaraan yang terlihat pada satu bingkai per kamera tiap 20 menit, dihitung di memori; gambar "
                    "tidak disimpan. Indeks = rata-rata jam terakhir dibanding jam yang sama pada hari-hari sebelumnya di kamera "
                    "itu. Belum masuk angka peta (belum lolos uji lokasi disembunyikan)."),
        "kamera": rows,
    }


def riwayat_dari_arsip(s3, bucket: str, now: datetime, hari: int = RIWAYAT_HARI) -> dict:
    """Rebuild the history from the archived runs (hitung/<date>/<HHMM>.json) when the stored one is in the old format."""
    runs = []
    for d in range(hari, -1, -1):
        day = (now - timedelta(days=d)).strftime("%Y-%m-%d")
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"hitung/{day}/"):
            for o in page.get("Contents", []):
                t = datetime.strptime(o["Key"][7:22], "%Y-%m-%d/%H%M").replace(tzinfo=timezone.utc)
                r = json.loads(s3.get_object(Bucket=bucket, Key=o["Key"])["Body"].read())
                runs.append({"t": t.strftime("%Y-%m-%dT%H:%MZ"), "v": {_k(h): (h.get("total") if h["status"] == "ok" else None) for h in r["hasil"]}})
    runs.sort(key=lambda r: r["t"])
    return {"format": "riwayat_v2", "runs": runs}


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
    if riwayat.get("format") != "riwayat_v2":
        riwayat = riwayat_dari_arsip(s3, bucket, now)
    riwayat = perbarui_riwayat(riwayat, run, now)
    for key in (kunci(now), "hitung/terbaru.json"):
        tulis(s3, bucket, key, run, "no-cache")
    tulis(s3, bucket, "hitung/riwayat.json", riwayat, "no-cache")
    publik = os.environ.get("PUBLIK_BUCKET")
    if publik:
        s3p = boto3.client("s3", region_name=os.environ.get("PUBLIK_REGION", "ap-southeast-1"))
        tulis(s3p, publik, "v/nasional/cctv.json", ringkas_publik(kamera, run, riwayat, now), "public, max-age=300")
    ringkas = {"key": kunci(now), "kamera": run["kamera"], "berhasil": run["berhasil"], "buram": run["buram"], "detik": run["detik"]}
    print(json.dumps(ringkas))
    return ringkas
