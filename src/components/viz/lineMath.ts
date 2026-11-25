/** Scale and path helpers of LineChart (kept apart so the component file only exports components). */
export const W = 320;
export const H = 120;
export const PAD = { l: 30, r: 8, t: 8, b: 18 };

/** Scale helpers shared with the tests: map an index and a value into the 320x120 drawing box. */
export function lineScale(n: number, lo: number, hi: number) {
  const span = hi - lo || 1;
  return {
    x: (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r)),
    y: (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b),
  };
}

/** Path for one series; a null value breaks the line (missing hour). */
export function linePath(values: (number | null)[], lo: number, hi: number): string {
  const s = lineScale(values.length, lo, hi);
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${s.x(i).toFixed(1)},${s.y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

