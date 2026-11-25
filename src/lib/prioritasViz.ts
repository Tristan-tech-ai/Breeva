/** N-06: how far the facilities are from a busy road, in a few bands (counts per band, nearest band first). */
export const JARAK_BANDS: Array<[number, number, string]> = [[0, 50, '< 50 m'], [50, 100, '50–100 m'], [100, 200, '100–200 m'], [200, 500, '200–500 m'], [500, Infinity, '> 500 m']];

export function sebaranJarak(items: Array<{ d_ramai_m: number }>): Array<{ label: string; n: number }> {
  return JARAK_BANDS.map(([lo, hi, label]) => ({ label, n: items.filter((f) => f.d_ramai_m >= lo && f.d_ramai_m < hi).length }));
}
