/** Labels and comparisons for the walking route cards (pure, tested). */
import { steadyStatus } from './loadProgress';
import type { WalkRoute } from './client';
import { bestSoon } from './departForecast';

export interface RouteCard {
  index: number; label: string; color: string;
  km: string; minutes: number; no2: number; pm25: number;
  /** Mean vehicle exhaust along the route (traffic NOx, ug/m3), 1 decimal; null when the worker did not report it. */
  exh: number | null;
  /** The first line of the card: the exhaust breathed on this route against the fastest route. */
  headline: string;
  /** Which hour the numbers are for when it is not the map's hour (a later departure). */
  forecastNote: string | null;
  /** Leaving a little later or earlier on the same route breathes clearly less exhaust. */
  soonHint: string | null;
  /** Motor routes: mean harga hirup along the route (the exposure imposed on others), 2 decimals. */
  harga: number | null;
  /**
   * Versus the fastest route: extra time (% and minutes), NO2 change (%) and the change in the exhaust dose (%), i.e.
   * mean exhaust x time on the route; rounded; null for the fastest itself. exhDosePct is null without exhaust data.
   */
  vsFastest: { extraTimePct: number; extraMin: number; no2Pct: number; exhDosePct: number | null } | null;
  /** Motor routes during school hours: what the school zone did to this route. */
  schoolNote: string | null;
  /** Motor routes during school hours: the minutes and metres the zone adds, or that it changes nothing. */
  schoolCost: string | null;
}

export const SCHOOL_NOTES = {
  kept: 'Jam sekolah: rute tidak lewat jalan kecil di depan sekolah',
  'lifted-near-ends': 'Jam sekolah: dekat titik berangkat atau tujuan rute ini terpaksa lewat depan sekolah (tidak ada jalan lain)',
} as const;

/**
 * What the school zone costs this trip, against the same kind of route computed without the zone (the worker does
 * this only while the zone is on). Differences under 1 minute and 50 m are shown as no change in time.
 */
export function schoolCostText(cost: { extraM: number; extraS: number; changed: boolean } | null | undefined): string | null {
  if (!cost) return null;
  if (!cost.changed) return 'Zona sekolah tidak mengubah rute ini';
  const min = Math.round(cost.extraS / 60), m = Math.round(cost.extraM / 10) * 10;
  if (min < 0 || m < 0) {
    // the zone-free route is chosen by the same two-number cost, so the zoned one can be shorter or quicker
    const parts = [
      m >= 50 ? `${m.toLocaleString('id-ID')} m lebih jauh` : m <= -50 ? `${(-m).toLocaleString('id-ID')} m lebih dekat` : null,
      min >= 1 ? `${min} menit lebih lama` : min <= -1 ? `${-min} menit lebih cepat` : null,
    ].filter(Boolean);
    if (parts.length) return `Zona sekolah mengubah rute: ${parts.join(', ')} dibanding rute tanpa zona`;
  }
  if (min < 1 && m < 50) return 'Zona sekolah mengubah jalannya, tanpa tambahan waktu yang berarti';
  const parts = [min >= 1 ? `${min} menit` : 'kurang dari 1 menit', m >= 50 ? `${m.toLocaleString('id-ID')} m` : null].filter(Boolean);
  return `Zona sekolah menambah ${parts.join(' dan ')} dibanding rute tanpa zona`;
}

/** Fastest orange, cleanest teal, the rest slate: none of them an ISPU colour (Sedang is blue), drawn on a white casing. */
export const ROUTE_COLORS = { fastest: '#c2410c', cleanest: '#0f766e', other: '#475569' } as const;

/** Below this mean (ug/m3 of traffic NOx) a route has practically no exhaust of its own to compare. */
export const EXHAUST_FLOOR = 0.5;

/**
 * The first line of a route card. The dose is mean exhaust x minutes, so a longer but cleaner route is judged on
 * what is actually breathed. Differences under 5 % are called "hampir sama": the model cannot tell them apart.
 */
export function exhaustHeadline(exh: number | null, dosePct: number | null, fastestExh: number | null): string {
  if (exh == null) return 'Asap kendaraan: data belum tersedia untuk rute ini';
  const mean = `${exh.toLocaleString('id-ID', { maximumFractionDigits: 1 })} µg/m³`;
  if (dosePct == null) return exh < EXHAUST_FLOOR ? 'Hampir tanpa asap kendaraan di sepanjang rute' : `Asap kendaraan rata-rata ${mean} (patokan)`;
  if (fastestExh != null && fastestExh < EXHAUST_FLOOR && exh < EXHAUST_FLOOR) return 'Hampir tanpa asap kendaraan, sama seperti rute tercepat';
  if (dosePct <= -5) return `Asap kendaraan dihirup ${-dosePct}% lebih sedikit dari rute tercepat`;
  if (dosePct >= 5) return `Asap kendaraan dihirup ${dosePct}% lebih banyak dari rute tercepat`;
  return 'Asap kendaraan hampir sama dengan rute tercepat';
}

export function routeCards(routes: WalkRoute[]): RouteCard[] {
  if (!routes.length) return [];
  const f = routes[0];
  const fExh = f.exhMean != null && Number.isFinite(f.exhMean) ? Math.round(f.exhMean * 10) / 10 : null;
  return routes.map((r, k) => {
    const last = k === routes.length - 1 && routes.length > 1;
    let label = k === 0 ? 'Tercepat' : last ? 'Paling sedikit asap kendaraan' : `Alternatif ${k}`;
    let color: string = k === 0 ? ROUTE_COLORS.fastest : last ? ROUTE_COLORS.cleanest : ROUTE_COLORS.other;
    if (r.kind === 'darurat') { label = 'Darurat: tercepat, tanpa poin'; color = ROUTE_COLORS.fastest; }
    if (r.kind === 'dua-angka') { label = 'Dua angka (disarankan)'; color = ROUTE_COLORS.cleanest; }
    const exh = r.exhMean != null && Number.isFinite(r.exhMean) ? Math.round(r.exhMean * 10) / 10 : null;
    const exhDosePct = k === 0 || r.exhMean == null || f.exhMean == null || !(f.exhMean * f.timeS > 0) ? null
      : Math.round(((r.exhMean * r.timeS) / (f.exhMean * f.timeS) - 1) * 100);
    const hh = (h: number) => `${String(h).padStart(2, '0')}.00`;
    const best = r.soon && r.exhMean != null ? bestSoon(r.exhMean, r.soon) : null;
    return {
      index: k, label, color, exh, headline: exhaustHeadline(exh, exhDosePct, fExh),
      forecastNote: r.forecastHour != null ? `Perkiraan untuk sekitar jam ${hh(r.forecastHour)}: angin prakiraan dan pola lalu lintas jam itu` : null,
      soonHint: best ? `Berangkat sekitar jam ${hh(best.hour.local_hour)} lewat rute ini: asap kendaraan ${best.pct}% lebih sedikit daripada berangkat sekarang` : null,
      harga: r.hargaMean != null ? Math.round(r.hargaMean * 100) / 100 : null,
      schoolNote: r.school === 'kept' || r.school === 'lifted-near-ends' ? SCHOOL_NOTES[r.school] : null,
      schoolCost: r.school === 'kept' || r.school === 'lifted-near-ends' ? schoolCostText(r.schoolCost) : null,
      km: (r.lengthM / 1000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      minutes: Math.max(1, Math.round(r.timeS / 60)),
      no2: Math.round(r.no2Mean * 10) / 10, pm25: Math.round(r.pm25Mean * 10) / 10,
      vsFastest: k === 0 ? null : {
        extraTimePct: Math.round((r.timeS / f.timeS - 1) * 100),
        extraMin: Math.round((r.timeS - f.timeS) / 60),
        no2Pct: Math.round((r.no2Mean / f.no2Mean - 1) * 100),
        exhDosePct,
      },
    };
  });
}

/**
 * One short sentence set for screen readers when routes arrive (F1-47): how many routes, then per route its label,
 * distance, minutes and first line, plus the school-zone cost and a leave-later hint when there are any. Without
 * cards the status line (computing, error) is announced.
 */
export function announceRoutes(cards: RouteCard[], status: string): string {
  if (!cards.length) return steadyStatus(status); // the download message changes every second (X-W4)
  const parts = cards.map((c) => [
    `${c.label}: ${c.km} km, ${c.minutes} menit.`,
    c.headline ? `${c.headline.replace(/\.$/, '')}.` : '',
    c.schoolCost ? `${c.schoolCost.replace(/\.$/, '')}.` : '',
    c.soonHint ? `${c.soonHint.replace(/\.$/, '')}.` : '',
  ].filter(Boolean).join(' '));
  return `${cards.length} rute. ${parts.join(' ')}`;
}
