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


def satu_bingkai(url: str, timeout_s: float = 12.0) -> np.ndarray | None:
    """The first decodable video frame of an HLS stream as an RGB array, in memory only."""
    import av  # imported here so the pure parts load without PyAV

    try:
        with av.open(url, timeout=timeout_s, options={"rw_timeout": str(int(timeout_s * 1e6))}) as c:
            for frame in c.decode(video=0):
                return frame.to_ndarray(format="rgb24")
    except Exception:  # noqa: BLE001  (an offline camera is a normal state)
        return None
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


def jalankan(kamera: list[dict], penghitung, ambil=satu_bingkai, paralel: int = 16, model: str = "") -> dict:
    """One run over all cameras: counts or a state per camera, never the image."""
    t0 = time.time()
    with ThreadPoolExecutor(paralel) as ex:
        hasil = list(ex.map(lambda c: satu_kamera(c, penghitung, ambil), kamera))
    return {
        "format": "cctv_hitung",
        "waktu_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
        "detik": round(time.time() - t0, 1),
        "kamera": len(kamera),
        "berhasil": sum(1 for h in hasil if h["status"] == "ok"),
        "buram": sum(1 for h in hasil if h["status"] == "buram"),
        "label": LABEL,
        "model": model,
        "hasil": hasil,
    }
