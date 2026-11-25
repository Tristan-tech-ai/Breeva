"""breeva-cctv (task N-33): counts leave the function, pictures do not; the trial switches itself off on 6 Dec 2026."""
import json
import os
import re
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path[:0] = [os.path.join(ROOT, "vayu", "field"), os.path.join(ROOT, "infra", "cctv")]
from app import LABEL as LABEL_APP, kunci, perbarui_riwayat, ringkas_publik, sudah_mati, tanpa_rahasia  # noqa: E402
from cctv_count import SHARP_MIN  # noqa: E402
from hitung import LABEL, hitung_bingkai, jalankan  # noqa: E402


class Palsu:
    """A detector that sees two cars and a motorcycle in every frame and remembers how many frames it saw."""

    def __init__(self):
        self.n = 0

    def deteksi(self, rgb):
        self.n += 1
        box = np.zeros(4, np.float32)
        return [(2, 0.9, box), (2, 0.8, box), (3, 0.7, box)]


def gambar(tajam: bool) -> np.ndarray:
    rng = np.random.default_rng(1)
    if tajam:
        return rng.integers(0, 255, (36, 64, 3), dtype=np.uint8)
    return np.full((36, 64, 3), 90, np.uint8)


KAMERA = [
    {"id": "a", "kota": "kota_bogor", "url": "https://kamera.example/a.m3u8", "lat": -6.6, "lon": 106.8},
    {"id": "b", "kota": "kota_bogor", "url": "https://kamera.example/b.m3u8", "lat": -6.6, "lon": 106.8},
    {"id": "c", "kota": "kota_bandung", "url": "https://kamera.example/c.m3u8", "lat": -6.9, "lon": 107.6},
]


def ambil(url):
    return {"a": gambar(True), "b": gambar(False)}.get(url.rsplit("/", 1)[1][0])


def test_counts_per_kind_from_detections():
    box = np.zeros(4)
    assert hitung_bingkai([(2, 0.9, box), (3, 0.5, box), (7, 0.4, box), (7, 0.4, box)]) == {"mobil": 1, "motor": 1, "bus": 0, "truk": 2}


def test_run_reports_counts_or_state_and_never_the_url_or_the_picture(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = Palsu()
    run = tanpa_rahasia(jalankan(KAMERA, p, ambil=ambil, paralel=2, model="uji"))
    by = {h["id"]: h for h in run["hasil"]}
    assert by["a"]["status"] == "ok" and by["a"]["mobil"] == 2 and by["a"]["motor"] == 1 and by["a"]["total"] == 3
    assert by["b"]["status"] == "buram" and by["b"]["tajam"] < SHARP_MIN and "total" not in by["b"]
    assert by["c"]["status"] == "offline"
    assert p.n == 1  # the blurred and the offline camera never reach the detector
    assert run["kamera"] == 3 and run["berhasil"] == 1 and run["buram"] == 1 and run["label"] == LABEL
    text = json.dumps(run)  # serialisable: no array left in the run
    assert "m3u8" not in text and "kamera.example" not in text and "lat" not in text
    assert list(tmp_path.iterdir()) == []  # nothing written to the working folder


def test_guard_drops_any_field_beyond_the_counts():
    run = {"kamera": 1, "hasil": [{"id": "a", "kota": "k", "status": "ok", "total": 1, "url": "u", "bingkai": [1, 2]}]}
    assert tanpa_rahasia(run)["hasil"] == [{"id": "a", "kota": "k", "status": "ok", "total": 1}]


def test_switch_off_at_6_dec_wib():
    assert not sudah_mati(datetime(2026, 12, 5, 16, 59, 59, tzinfo=timezone.utc))
    assert sudah_mati(datetime(2026, 12, 5, 17, 0, 0, tzinfo=timezone.utc))
    # the EventBridge Scheduler format (yyyy-MM-ddTHH:mm:ss.SSSZ, found when the first stack create failed) also parses
    assert sudah_mati(datetime(2026, 12, 5, 17, 0, 0, tzinfo=timezone.utc), "2026-12-05T17:00:00.000Z")
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", __import__("app").MATI_UTC)
    assert kunci(datetime(2026, 11, 25, 13, 40, tzinfo=timezone.utc)) == "hitung/2026-11-25/1340.json"


def test_schedule_and_function_end_on_the_same_date():
    tpl = open(os.path.join(ROOT, "infra", "aws", "breeva-cctv.yaml"), encoding="utf-8").read()
    assert re.search(r"EndDate:\n\s+Type: String\n\s+Default: '2026-12-05T17:00:00.000Z'", tpl)
    assert "EndDate: !Ref EndDate" in tpl and "MATI_UTC: !Ref EndDate" in tpl
    assert "rate(20 minutes)" in tpl
    import app

    assert app.MATI_UTC == "2026-12-05T17:00:00.000Z"


def test_no_code_path_writes_a_picture():
    """Static check of the three modules in the image: no file is opened for writing, no array saved, no image codec."""
    for f in ("infra/cctv/hitung.py", "infra/cctv/app.py", "vayu/field/cctv_count.py"):
        src = open(os.path.join(ROOT, f), encoding="utf-8").read()
        assert not re.search(r"open\([^)]*['\"][wa]b?['\"]", src), f
        for bad in (".tofile(", "np.save", "imwrite", "Image.save", ".save(", "av.open(url, 'w'", "mode=\"w\""):
            assert bad not in src, (f, bad)
    app_src = open(os.path.join(ROOT, "infra", "cctv", "app.py"), encoding="utf-8").read()
    # one writer, and it writes JSON only
    assert app_src.count("put_object(") == 1 and "body = json.dumps(obj" in app_src and "Body=body" in app_src


def test_history_keeps_the_last_72_runs_and_none_for_offline():
    run = {"hasil": [{"id": "a", "kota": "k", "status": "ok", "total": 4}, {"id": "b", "kota": "k", "status": "buram"}]}
    r = perbarui_riwayat({"k:a": list(range(72))}, run)
    assert len(r["k:a"]) == 72 and r["k:a"][-1] == 4 and r["k:a"][0] == 1
    assert r["k:b"] == [None]


def test_public_summary_index_needs_three_hours_and_carries_no_url():
    kam = [{"id": "a", "kota": "k", "nama": "Jl. Uji", "url": "https://kamera.example/a.m3u8", "lat": -6.6, "lon": 106.8},
           {"id": "b", "kota": "k", "nama": "Jl. Baru", "url": "https://kamera.example/b.m3u8", "lat": -6.7, "lon": 106.9}]
    run = {"waktu_utc": "2026-11-25T14:00:00Z", "model": "uji", "hasil": [
        {"id": "a", "kota": "k", "status": "ok", "total": 9}, {"id": "b", "kota": "k", "status": "ok", "total": 2}]}
    riw = {"k:a": [3] * 9 + [6, 9, 9], "k:b": [2, 2]}
    pub = ringkas_publik(kam, run, riw)
    a, b = pub["kamera"]
    assert a["rata_jam"] == 8.0 and a["indeks"] == round(8.0 / 3, 2) and a["tingkat"] == "padat" and a["total"] == 9
    assert b["rata_jam"] == 2.0 and b["indeks"] is None and b["tingkat"] is None  # 2 runs: no typical level yet
    assert pub["label"] == LABEL == LABEL_APP and "belum lolos uji" in pub["catatan"].lower()
    assert "m3u8" not in json.dumps(pub) and "url" not in a
