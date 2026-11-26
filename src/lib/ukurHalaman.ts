/** M-U04: summary of the in-page lag meter (frame intervals and long tasks in ms). */
export interface HasilUkur { p95: number; tugasMaks: number; jank: number; objek: number; bingkai: number }

export function ringkasUkur(frames: number[], longs: number[], objek: number): HasilUkur {
  const f = [...frames].sort((a, b) => a - b);
  const p95 = f.length ? f[Math.min(f.length - 1, Math.floor(0.95 * f.length))] : 0;
  return { p95: Math.round(p95), tugasMaks: Math.round(Math.max(0, ...longs)), jank: f.filter((x) => x > 100).length, objek, bingkai: f.length };
}
