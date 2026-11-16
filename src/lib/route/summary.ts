/** Labels and comparisons for the walking route cards (pure, tested). */
import type { WalkRoute } from './client';

export interface RouteCard {
  index: number; label: string; color: string;
  km: string; minutes: number; no2: number; pm25: number;
  /** Motor routes: mean harga hirup along the route (the exposure imposed on others), 2 decimals. */
  harga: number | null;
  /** Versus the fastest route: extra time (%) and NO2 change (%), rounded; null for the fastest itself. */
  vsFastest: { extraTimePct: number; no2Pct: number } | null;
}

/** Fastest orange, cleanest teal, the rest slate: none of them an ISPU colour (Sedang is blue), drawn on a white casing. */
export const ROUTE_COLORS = { fastest: '#c2410c', cleanest: '#0f766e', other: '#475569' } as const;

export function routeCards(routes: WalkRoute[]): RouteCard[] {
  if (!routes.length) return [];
  const f = routes[0];
  return routes.map((r, k) => {
    const last = k === routes.length - 1 && routes.length > 1;
    let label = k === 0 ? 'Tercepat' : last ? 'Terbersih (NO₂)' : `Alternatif ${k}`;
    let color: string = k === 0 ? ROUTE_COLORS.fastest : last ? ROUTE_COLORS.cleanest : ROUTE_COLORS.other;
    if (r.kind === 'darurat') { label = 'Darurat: tercepat, tanpa poin'; color = ROUTE_COLORS.fastest; }
    if (r.kind === 'dua-angka') { label = 'Dua angka (disarankan)'; color = ROUTE_COLORS.cleanest; }
    return {
      index: k, label, color,
      harga: r.hargaMean != null ? Math.round(r.hargaMean * 100) / 100 : null,
      km: (r.lengthM / 1000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      minutes: Math.max(1, Math.round(r.timeS / 60)),
      no2: Math.round(r.no2Mean * 10) / 10, pm25: Math.round(r.pm25Mean * 10) / 10,
      vsFastest: k === 0 ? null : {
        extraTimePct: Math.round((r.timeS / f.timeS - 1) * 100),
        no2Pct: Math.round((r.no2Mean / f.no2Mean - 1) * 100),
      },
    };
  });
}
