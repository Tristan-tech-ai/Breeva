/**
 * N-42: Indonesian number formatting with cached Intl.NumberFormat objects. `x.toLocaleString('id-ID', opts)` builds a
 * new formatter on every call (~0.1 ms each); a list of 150 rows or 1,400 fire tooltips spent 130-190 ms of one main-thread
 * task on it while loading on a slow phone (measured with .claude/loop/lag_ukur.mjs).
 */
const cache = new Map<string, Intl.NumberFormat>();

export function formatAngka(x: number, min = 0, max = min): string {
  const key = `${min}|${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f.format(x);
}
