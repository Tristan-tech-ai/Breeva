"""Vehicle counts from public traffic cameras (task N-33), for the contest trial only (switched off 6 Dec 2026 until written
permission exists). One frame per camera per run is decoded IN MEMORY from the open HLS stream (PyAV), the vehicles in
it are detected with YOLOX (the decoder of vayu/field/cctv_count.py, Apache-2.0 model), and the frame is dropped: no
frame is ever written to disk, S3 or a log. Only the counts per camera leave this module.

A single frame counts the vehicles present at that moment (a density index), not the flow per hour; a blurred or dark
picture (sharpness below cctv_count.SHARP_MIN) is reported as 'buram' instead of zero vehicles.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from cctv_count import CLASSES, SHARP_MIN, decode, letterbox, sharpness

LABEL = "uji coba selama lomba, izin tertulis sedang diproses"


def hitung_bingkai(dets: list[tuple[int, float, np.ndarray]]) -> dict[str, int]:
    """Counts per vehicle kind from the detections of one frame."""
    out = {k: 0 for k in CLASSES.values()}
    for c, _, _ in dets:
        out[CLASSES[c]] += 1
    return out


KEYFRAME_MAKS = 90  # frames decoded while waiting for a keyframe (about 3-6 s of video)


def pilih_bingkai(frames, maks: int = KEYFRAME_MAKS):
    """The first keyframe of a decoded stream (N-44: Bandung segments start mid-GOP, and the first decoded frames are
    flat grey, sharpness 0.05-0.2, counted as 'buram' in daylight); after `maks` frames without one, the last frame."""
    last = None
    for i, frame in enumerate(frames):
        last = frame
        if getattr(frame, "key_frame", False):
            return frame
        if i + 1 >= maks:
            break
    return last


def satu_bingkai(url: str, timeout_s: float = 12.0) -> np.ndarray | None:
    """One keyframe of an HLS stream as an RGB array, in memory only."""
    import av  # imported here so the pure parts load without PyAV

    try:
        with av.open(url, timeout=timeout_s, options={"rw_timeout": str(int(timeout_s * 1e6))}) as c:
            frame = pilih_bingkai(c.decode(video=0))
            return frame.to_ndarray(format="rgb24") if frame is not None else None
    except Exception:  # noqa: BLE001  (an offline camera is a normal state)
        return None


class Penghitung:
    """The YOLOX ONNX detector, loaded once per container; the input size is read from the model (tiny 416, s 640)."""

    def __init__(self, model_path: str, conf: float = 0.3):
        import onnxruntime as ort

        self.s = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.inp = self.s.get_inputs()[0].name
        self.size = int(self.s.get_inputs()[0].shape[2])
        self.conf = conf

    def deteksi(self, rgb: np.ndarray) -> list[tuple[int, float, np.ndarray]]:
        x, r = letterbox(rgb[:, :, ::-1], self.size)  # YOLOX ONNX expects BGR, 0-255, no normalisation
        raw = self.s.run(None, {self.inp: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        return decode(raw, r, conf=self.conf, size=self.size)


def satu_kamera(cam: dict, penghitung, ambil) -> dict:
    """Counts for one camera, or its state: 'offline' (no frame) or 'buram' (a picture without edges)."""
    rgb = ambil(cam["url"])
    base = {"id": cam["id"], "kota": cam["kota"]}
    if rgb is None:
        return {**base, "status": "offline"}
    tajam = round(sharpness(rgb), 2)
    if tajam < SHARP_MIN:
        return {**base, "status": "buram", "tajam": tajam}
    n = hitung_bingkai(penghitung.deteksi(rgb))
    return {**base, "status": "ok", "tajam": tajam, **n, "total": sum(n.values())}


PER_HOST = 6  # at most this many open streams per camera server at once (N-44: one server carries all 299 Bandung cameras)


def host(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).netloc


def jalankan(kamera: list[dict], penghitung, ambil=satu_bingkai, paralel: int = 16, model: str = "", per_host: int = PER_HOST,
             ulang_jeda_s: float = 5.0) -> dict:
    """One run over all cameras: counts or a state per camera, never the image. Streams of one server are limited to
    `per_host` at a time; cameras offline in the first pass are tried once more after `ulang_jeda_s` (N-44: the Bandung
    server refused 236-265 of its 299 streams in about one run of four, 25-26 Nov)."""
    import threading

    t0 = time.time()
    kunci: dict[str, threading.Semaphore] = {}
    for c in kamera:
        kunci.setdefault(host(c["url"]), threading.Semaphore(per_host))

    def satu(c: dict) -> dict:
        with kunci[host(c["url"])]:
            return satu_kamera(c, penghitung, ambil)

    with ThreadPoolExecutor(paralel) as ex:
        hasil = list(ex.map(satu, kamera))
    ulang = [i for i, h in enumerate(hasil) if h["status"] == "offline"]
    if ulang:
        time.sleep(ulang_jeda_s)
        with ThreadPoolExecutor(paralel) as ex:
            for i, h in zip(ulang, ex.map(satu, [kamera[i] for i in ulang])):
                hasil[i] = h if h["status"] != "offline" else hasil[i]
    return {
        "format": "cctv_hitung",
        "waktu_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
        "detik": round(time.time() - t0, 1),
        "kamera": len(kamera),
        "berhasil": sum(1 for h in hasil if h["status"] == "ok"),
        "buram": sum(1 for h in hasil if h["status"] == "buram"),
        "diulang": len(ulang),
        "label": LABEL,
        "model": model,
        "hasil": hasil,
    }
