/**
 * The walk screen (Tristan, 27 Nov 2026, picture at 09.26 WITA): pure rules, tested in tests/perjalanan.test.ts.
 *  - the destination is a name, not "-8.6083, 115.1619" (the reverse geocoder of the old app answers 410 since ORS moved);
 *  - "Kamu keluar dari rute" only when the phone is really off the line: the GPS error is counted and it takes two fixes
 *    in a row (one wobbly fix at the start set it while the walker stood at the start);
 *  - the walked line runs from the walker's own start to the destination pin, not only between the graph's nodes.
 */
import type { POI } from '../poi-api';

const R = 6371008.8;
const rad = Math.PI / 180;
export function meterAntara(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return R * Math.hypot(x, y);
}

/** A destination name from the region's place pack: the place itself within 30 m, "Dekat ..." within 120 m, else null. */
export function namaTujuan(pois: readonly Pick<POI, 'name' | 'coordinate'>[], titik: { lat: number; lng: number }, maks = 120): string | null {
  let best: Pick<POI, 'name' | 'coordinate'> | null = null, bestD = Infinity;
  for (const p of pois) {
    if (!p.name) continue;
    const d = meterAntara(titik, p.coordinate);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best || bestD > maks) return null;
  return bestD <= 30 ? best.name : `Dekat ${best.name}`;
}

/** Name when nothing nearby is known. */
export const TUJUAN_TANPA_NAMA = 'Titik di peta';

/** Metres off the line before a fix counts as off the route: 30 m, or more when the phone says its fix is coarse. */
export function batasKeluar(akurasiM: number | null | undefined): number {
  const a = Number.isFinite(akurasiM as number) ? (akurasiM as number) : 0;
  return Math.max(30, 1.2 * a + 10);
}

/** Off the route only after two fixes in a row beyond the limit; returns the new streak and the verdict. */
export function nilaiKeluar(jarakGarisM: number, akurasiM: number | null | undefined, beruntun: number): { beruntun: number; keluar: boolean } {
  const n = jarakGarisM > batasKeluar(akurasiM) ? beruntun + 1 : 0;
  return { beruntun: n, keluar: n >= 2 };
}

/**
 * The line of a walk: the route's polyline, starting at the walker's own position and ending at the destination pin when
 * those lie near the route's ends (the route starts and ends at the nearest node of the walking graph).
 */
export function garisPerjalanan(garis: Array<{ lat: number; lng: number }>, awal?: { lat: number; lng: number } | null,
  tujuan?: { lat: number; lng: number } | null, dekatM = 200): Array<{ lat: number; lng: number }> {
  if (!garis.length) return garis;
  const out = [...garis];
  if (awal && meterAntara(awal, out[0]) > 1 && meterAntara(awal, out[0]) <= dekatM) out.unshift({ lat: awal.lat, lng: awal.lng });
  const akhir = out[out.length - 1];
  if (tujuan && meterAntara(tujuan, akhir) > 1 && meterAntara(tujuan, akhir) <= dekatM) out.push({ lat: tujuan.lat, lng: tujuan.lng });
  return out;
}

/** Indonesian distance text: "350 m", "1,2 km". */
export function teksJarak(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

/** The walked kilometres on the stats row: "0,00". */
export function teksKm(m: number): string {
  return (m / 1000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Speed for the time left on a walk (Tristan, 27 Nov: the card said 16 min and the walk screen 30 min). The walk screen
 * divided the distance left by the average speed so far, floored at 0.7 m/s: three seconds in, nothing walked yet, that
 * floor made 1.2 km into 30 min. Now the planned speed of the route (the card's own) counts until the walker has covered
 * some ground, then the measured average takes over gradually (fully after 500 m); the measured average is kept to
 * 0.5-2.2 m/s for walking (2-20 m/s otherwise) so a GPS jump or a long stop does not swing the estimate.
 */
export function kecepatanSisa(rencanaMps: number, jarakM: number, waktuS: number, jalanKaki = true): number {
  const rencana = Number.isFinite(rencanaMps) && rencanaMps > 0 ? rencanaMps : (jalanKaki ? 1.3 : 8);
  if (!(waktuS > 0) || !(jarakM > 0)) return rencana;
  const [lo, hi] = jalanKaki ? [0.5, 2.2] : [2, 20];
  const ukur = Math.min(hi, Math.max(lo, jarakM / waktuS));
  const bobot = Math.min(1, jarakM / 500);
  return (1 - bobot) * rencana + bobot * ukur;
}
