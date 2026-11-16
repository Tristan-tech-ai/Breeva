import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "field"))
from harga_hirup import CELL_M, SECTORS, Raster, correlate, iso_kernel_value, sector_kernel  # noqa: E402

R = int(500 // CELL_M)


def test_sector_kernel_points_downwind():
    K = sector_kernel(6)  # wind from the west (270 degrees): blows east
    east, west = K[R, R + 20], K[R, R - 20]
    north, south = K[R + 20, R], K[R - 20, R]
    assert east > 0 and west == 0 and north == 0 and south == 0
    K0 = sector_kernel(0)  # wind from the north: blows south (rows ascend northwards)
    assert K0[R - 20, R] > 0 and K0[R + 20, R] == 0


def test_sector_mean_is_the_wind_averaged_kernel():
    mean = np.mean([sector_kernel(k) for k in range(SECTORS)], axis=0)
    off = np.arange(-R, R + 1) * CELL_M
    E, N = np.meshgrid(off, off)
    r = np.hypot(E, N)
    ring = (r > 190) & (r < 210)
    want = float(iso_kernel_value(200.0))
    assert abs(mean[ring].mean() / want - 1) < 0.03
    assert iso_kernel_value(20) > iso_kernel_value(100) > iso_kernel_value(400) > 0


def test_correlation_puts_the_breathing_on_the_upwind_road():
    rast = Raster((115.20, -8.66, 115.22, -8.64))
    lon_src, lat_src = 115.21, -8.65
    dx = 100.0 / rast.kx  # a building 100 m east of the road point
    A = rast.accumulate(np.array([lon_src + dx]), np.array([lat_src]), np.array([500.0]))
    y, x = rast.ij(lon_src, lat_src)
    iy, ix = int(round(float(y))), int(round(float(x)))
    from_west = correlate(A, sector_kernel(6))[iy, ix]
    from_east = correlate(A, sector_kernel(2))[iy, ix]
    assert from_west > 0 and from_east < 1e-12 * from_west
    # the value equals area * kernel at that offset
    assert math.isclose(from_west, 500.0 * sector_kernel(6)[R, R + 10], rel_tol=1e-6)
