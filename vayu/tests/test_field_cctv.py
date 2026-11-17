import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "field"))
from cctv_count import CLASSES, INPUT, SHARP_MIN, Counter, decode, grids, letterbox, nms, sharpness  # noqa: E402


def head_with(cells: list[tuple[int, int, float, int]]) -> np.ndarray:
    """A YOLOX head output that is empty except for the given (anchor index, class, score, size px) entries,
    each placed at its own grid cell centre."""
    g, s = grids()
    raw = np.zeros((len(g), 85), np.float32)
    raw[:, 4] = 0.0
    for idx, c, score, size in cells:
        raw[idx, 0:2] = 0.5  # centre of the cell
        raw[idx, 2:4] = np.log(size / s[idx, 0])
        raw[idx, 4] = 1.0
        raw[idx, 5 + c] = score
    return raw


def test_decode_returns_vehicle_classes_in_original_pixels_and_drops_other_classes():
    g, s = grids()
    idx = 100  # stride 8 row 1 col 20 -> centre (164, 12) at the 640 input
    raw = head_with([(idx, 2, 0.9, 40), (idx + 7, 0, 0.95, 40)])  # a car and a person
    dets = decode(raw, ratio=0.5)
    assert len(dets) == 1
    c, score, box = dets[0]
    assert CLASSES[c] == "mobil" and abs(score - 0.9) < 1e-6
    cx, cy = (g[idx] + 0.5) * s[idx, 0] / 0.5
    assert np.allclose(box, [cx - 40, cy - 40, cx + 40, cy + 40], atol=1e-3)


def test_nms_keeps_one_of_two_overlapping_boxes():
    b = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], np.float32)
    keep = nms(b, np.array([0.9, 0.8, 0.7]), 0.45)
    assert sorted(keep) == [0, 2]


def test_letterbox_keeps_aspect_ratio():
    img = np.zeros((576, 704, 3), np.uint8)
    out, r = letterbox(img)
    assert out.shape == (INPUT, INPUT, 3) and abs(r - INPUT / 704) < 1e-9
    assert out[INPUT - 1, 0, 0] == 114  # padding below the picture


def moving(cls: int, x: float, y0: float, dy: float, n: int, h: float = 30.0):
    return [[(cls, 0.9, np.array([x - 15, y0 + k * dy - h / 2, x + 15, y0 + k * dy + h / 2]))] for k in range(n)]


def test_a_vehicle_passing_the_middle_line_counts_once_and_one_stopping_short_does_not():
    ctr = Counter(height=576)
    a = moving(3, 100, 200, 20, 10)      # motorbike from y 200 down to 380: crosses 288
    b = moving(2, 500, 100, 10, 10)      # car from 100 to 190: never reaches the line
    for fa, fb in zip(a, b):
        ctr.update(fa + fb)
    res = ctr.result(seconds=2)
    assert res["crossings"] == {"mobil": 0, "motor": 1, "bus": 0, "truk": 0}
    assert res["veh_per_hour"]["motor"] == 1800
    assert res["present_mean"]["mobil"] == 1.0 and res["frames"] == 10


def test_both_directions_are_counted_and_classes_are_not_mixed():
    ctr = Counter(height=576)
    down = moving(7, 200, 240, 12, 8)    # truck going down
    up = moving(5, 400, 330, -12, 8)     # bus going up
    for fd, fu in zip(down, up):
        ctr.update(fd + fu)
    assert ctr.result(1)["crossings"] == {"mobil": 0, "motor": 0, "bus": 1, "truk": 1}


def test_a_track_lost_for_longer_than_the_gap_starts_again_and_is_not_counted_twice_by_jitter():
    ctr = Counter(height=576)
    # jitter around the line: centre goes 280, 296, 282, 295 ... crossing once at most
    for k in range(8):
        cy = 280 if k % 2 == 0 else 296
        ctr.update([(2, 0.9, np.array([90, cy - 15, 120, cy + 15]))])
    assert ctr.result(1)["crossings"]["mobil"] == 1


def test_a_flat_or_blurred_picture_is_not_usable_and_a_sharp_one_is():
    flat = np.full((576, 704, 3), 90, np.uint8)
    assert sharpness(flat) == 0.0
    edges = np.zeros((576, 704, 3), np.uint8)
    edges[:, ::8] = 200  # vertical lines every 8 px
    assert sharpness(edges) > SHARP_MIN
