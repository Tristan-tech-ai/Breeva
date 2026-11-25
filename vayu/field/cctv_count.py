"""Vehicle counts from a public traffic camera (task F5-14), without keeping any image.

For one camera: read a short clip from its HLS stream with ffmpeg straight into memory (raw frames on a pipe, never
written to disk), detect vehicles in each frame with YOLOX (Apache-2.0, Megvii, ONNX release 0.1.1rc0), follow them
from frame to frame, and count

  * present:  vehicles visible per frame by class (motor, mobil, bus, truk), averaged over the clip, and
  * crossing: vehicles whose track crosses the horizontal middle line of the picture, both directions together,
              turned into vehicles per hour (crossings / clip seconds x 3600).

Only the numbers leave this module. Classes are the COCO classes of the detector: car 2, motorcycle 3, bus 5,
truck 7.

    python vayu/field/cctv_count.py --cams cams.json --model D:/breeva-ml-data/models/yolox/yolox_s.onnx [--seconds 60 --fps 5]

cams.json: [{"id": 83, "nama": "...", "hls": "https://.../x.m3u8", "referer": "https://..."}]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field

import numpy as np

CLASSES = {2: "mobil", 3: "motor", 5: "bus", 7: "truk"}
INPUT = 640
STRIDES = (8, 16, 32)


# ---------------------------------------------------------------- detector (YOLOX output decoding, pure numpy)

def letterbox(img: np.ndarray, size: int = INPUT) -> tuple[np.ndarray, float]:
    """Resize keeping the aspect ratio into a size x size canvas filled with 114 (the YOLOX preprocessing)."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = int(h * r), int(w * r)  # as YOLOX preproc (int truncation)
    ys = (np.arange(nh) / r).astype(int).clip(0, h - 1)
    xs = (np.arange(nw) / r).astype(int).clip(0, w - 1)
    out = np.full((size, size, 3), 114, dtype=np.uint8)
    out[:nh, :nw] = img[ys][:, xs]
    return out, r


def grids(size: int = INPUT) -> tuple[np.ndarray, np.ndarray]:
    g, s = [], []
    for st in STRIDES:
        n = size // st
        yv, xv = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        g.append(np.stack((xv, yv), 2).reshape(-1, 2))
        s.append(np.full((n * n, 1), st))
    return np.concatenate(g).astype(np.float32), np.concatenate(s).astype(np.float32)


def decode(raw: np.ndarray, ratio: float, conf: float = 0.3, iou: float = 0.45, size: int = INPUT) -> list[tuple[int, float, np.ndarray]]:
    """YOLOX head output (N, 85) at a size x size input -> [(coco class, score, box x0 y0 x1 y1 in original pixels)]
    after NMS (YOLOX-s: 640, YOLOX-tiny: 416)."""
    g, s = grids(size)
    xy = (raw[:, :2] + g) * s
    wh = np.exp(raw[:, 2:4]) * s
    scores = raw[:, 4:5] * raw[:, 5:]
    cls = scores.argmax(1)
    best = scores[np.arange(len(cls)), cls]
    keep = (best >= conf) & np.isin(cls, list(CLASSES))
    if not keep.any():
        return []
    boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1)[keep] / ratio
    cls, best = cls[keep], best[keep]
    out = []
    for c in np.unique(cls):
        m = cls == c
        for k in nms(boxes[m], best[m], iou):
            out.append((int(c), float(best[m][k]), boxes[m][k]))
    return out


def box_iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    x0 = np.maximum(a[:, None, 0], b[None, :, 0]); y0 = np.maximum(a[:, None, 1], b[None, :, 1])
    x1 = np.minimum(a[:, None, 2], b[None, :, 2]); y1 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
    area = lambda z: (z[:, 2] - z[:, 0]) * (z[:, 3] - z[:, 1])
    return inter / (area(a)[:, None] + area(b)[None, :] - inter + 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, thr: float) -> list[int]:
    order, keep = list(np.argsort(-scores)), []
    while order:
        i = order.pop(0)
        keep.append(i)
        if order:
            o = np.array(order)
            order = [int(j) for j in o[box_iou(boxes[[i]], boxes[o])[0] < thr]]
    return keep


# ---------------------------------------------------------------- tracker and counts

@dataclass
class Track:
    tid: int
    cls: int
    cx: float
    cy: float
    first_cy: float
    last_seen: int
    crossed: bool = False


@dataclass
class Counter:
    """Greedy tracker: a detection joins the nearest live track of the same class whose centre is within
    `reach` box heights; a track counts once when its centre passes the middle line."""
    height: int
    reach: float = 1.5
    max_gap: int = 3
    tracks: list[Track] = field(default_factory=list)
    crossings: dict[str, int] = field(default_factory=lambda: {v: 0 for v in CLASSES.values()})
    present: dict[str, list[int]] = field(default_factory=lambda: {v: [] for v in CLASSES.values()})
    _next: int = 0
    frame: int = 0

    def update(self, dets: list[tuple[int, float, np.ndarray]]) -> None:
        mid = self.height / 2
        live = [t for t in self.tracks if self.frame - t.last_seen <= self.max_gap]
        used: set[int] = set()
        per = {v: 0 for v in CLASSES.values()}
        for c, _, b in sorted(dets, key=lambda d: -d[1]):
            per[CLASSES[c]] += 1
            cx, cy, bh = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, max(1.0, b[3] - b[1])
            best, bd = None, self.reach * bh
            for t in live:
                if t.tid in used or t.cls != c:
                    continue
                d = float(np.hypot(t.cx - cx, t.cy - cy))
                if d < bd:
                    best, bd = t, d
            if best is None:
                best = Track(self._next, c, cx, cy, cy, self.frame)
                self._next += 1
                self.tracks.append(best)
            elif not best.crossed and (best.first_cy - mid) * (cy - mid) < 0:
                best.crossed = True
                self.crossings[CLASSES[c]] += 1
            best.cx, best.cy, best.last_seen = cx, cy, self.frame
            used.add(best.tid)
        for k, v in per.items():
            self.present[k].append(v)
        self.frame += 1

    def result(self, seconds: float) -> dict:
        return {
            "present_mean": {k: round(float(np.mean(v)), 2) if v else 0.0 for k, v in self.present.items()},
            "crossings": dict(self.crossings),
            "veh_per_hour": {k: round(v / seconds * 3600) for k, v in self.crossings.items()},
            "frames": self.frame,
        }


# ---------------------------------------------------------------- picture quality

SHARP_MIN = 2.5  # mean horizontal step between neighbouring pixels; Juanda (blurred lens) 1.1-1.3, usable views 4.8-7.9


def sharpness(img: np.ndarray) -> float:
    """Mean absolute difference between horizontal neighbours (0 for a flat picture): a blurred, wet or covered lens
    shows almost no edges, and zero vehicles there means no picture, not no traffic."""
    return float(np.abs(np.diff(img.astype(np.int16), axis=1)).mean())


# ---------------------------------------------------------------- stream reading (memory only)

def frames(hls: str, referer: str | None, seconds: int, fps: int, width: int = 704, height: int = 576):
    """Yield RGB frames from the stream; ffmpeg writes raw pixels to a pipe, nothing touches the disk."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-rw_timeout", "20000000", "-user_agent", "Mozilla/5.0"]
    if referer:
        cmd += ["-headers", f"Referer: {referer}\r\n"]
    cmd += ["-i", hls, "-t", str(seconds), "-vf", f"fps={fps},scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    n = width * height * 3
    try:
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(height, width, 3)
    finally:
        p.kill()


def count_camera(sess, cam: dict, seconds: int, fps: int) -> dict:
    t0 = time.time()
    ctr = Counter(height=576)
    name = sess.get_inputs()[0].name
    sharp: list[float] = []
    for img in frames(cam["hls"], cam.get("referer"), seconds, fps):
        if ctr.frame % fps == 0:
            sharp.append(sharpness(img))
        x, r = letterbox(img[:, :, ::-1])  # YOLOX ONNX expects BGR, 0-255, no normalisation
        raw = sess.run(None, {name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        ctr.update(decode(raw, r))
    res = ctr.result(seconds)
    sm = float(np.median(sharp)) if sharp else 0.0
    res.update({"sharpness": round(sm, 2), "usable": bool(sharp) and sm >= SHARP_MIN})
    res.update({"id": cam["id"], "nama": cam.get("nama"), "seconds": seconds, "fps": fps, "wall_s": round(time.time() - t0, 1)})
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cams", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--fps", type=int, default=5)
    a = ap.parse_args()
    import onnxruntime as ort
    sess = ort.InferenceSession(a.model, providers=["CPUExecutionProvider"])
    sys.stdout.reconfigure(encoding="utf-8")
    for cam in json.load(open(a.cams, encoding="utf-8")):
        print(json.dumps(count_camera(sess, cam, a.seconds, a.fps), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
