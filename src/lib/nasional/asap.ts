/**
 * N-26: where the smoke of today's fires may go in the next 24 hours. Fire points within 5 km are one cluster; each
 * cluster's path follows the national 10 m wind hour by hour (1.5 degree grid, interpolated). A rough guess: no rise
 * or settling of the plume, no rain, no terrain. Kab/kota the path enters get an "asap menuju" card with the hour.
 */
import type { FirePoint } from './firms';
import { windAt, type WindFile } from './angin';
import { kmBetween } from './pantau';
import { cariWilayah, type WilayahIndex } from './wilayah';

export const CLUSTER_KM = 5;
export const MAX_CLUSTERS = 80;
export const PATH_HOURS = 24;

export interface Gugus { id: number; lon: number; lat: number; frp: number; n: number; asal: string | null }
export interface AsapFile {
  format: 'asap';
  updated_at: string;
  catatan: string;
  /** clusters, strongest first, with the path (lon, lat per hour, hour 0 = the cluster) */
  gugus: Array<Gugus & { jalur: Array<[number, number]> }>;
  /** per kab/kota slug: the clusters whose path enters it, earliest first (hours from now) */
  menuju: Record<string, Array<{ gugus: number; jam: number; asal: string | null }>>;
}

/** Greedy clusters: the strongest point opens a cluster, points within 5 km of its seed join it. */
export function gugusApi(points: FirePoint[], km = CLUSTER_KM, max = MAX_CLUSTERS): Gugus[] {
  const pts = [...points].sort((a, b) => b[2] - a[2]);
  const seeds: Array<{ seed: FirePoint; members: FirePoint[] }> = [];
  for (const p of pts) {
    const s = seeds.find((g) => kmBetween(g.seed[1], g.seed[0], p[1], p[0]) <= km);
    if (s) s.members.push(p); else seeds.push({ seed: p, members: [p] });
  }
  return seeds.map((g, id) => {
    const w = g.members.reduce((a, p) => a + Math.max(0.1, p[2]), 0);
    return {
      id, n: g.members.length, frp: Math.round(g.members.reduce((a, p) => a + p[2], 0) * 10) / 10,
      lon: Math.round((g.members.reduce((a, p) => a + p[0] * Math.max(0.1, p[2]), 0) / w) * 1e4) / 1e4,
      lat: Math.round((g.members.reduce((a, p) => a + p[1] * Math.max(0.1, p[2]), 0) / w) * 1e4) / 1e4,
      asal: g.seed[6] ?? null,
    };
  }).sort((a, b) => b.frp - a.frp).slice(0, max).map((g, id) => ({ ...g, id }));
}

/** Hourly positions from the cluster along the wind (hour 0 = start); stops where the wind grid has no value. */
export function jalurAsap(start: { lon: number; lat: number }, wind: WindFile, h0: number, hours = PATH_HOURS): Array<[number, number]> {
  const out: Array<[number, number]> = [[start.lon, start.lat]];
  let lon = start.lon, lat = start.lat;
  for (let k = 0; k < hours; k++) {
    const w = windAt(wind, lon, lat, Math.min(wind.hours.length - 1, h0 + k));
    if (!w) break;
    const to = ((w.from + 180) % 360) * (Math.PI / 180); // the wind blows towards from + 180
    const d = w.speed * 3600; // metres in one hour
    lat += (d * Math.cos(to)) / 111_320;
    lon += (d * Math.sin(to)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    out.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
  }
  return out;
}

export function asapFile(points: FirePoint[], wind: WindFile, h0: number, idx: WilayahIndex, now: Date): AsapFile {
  const gugus = gugusApi(points).map((g) => ({ ...g, jalur: jalurAsap(g, wind, h0) }));
  const menuju: AsapFile['menuju'] = {};
  for (const g of gugus) {
    const seen = new Set<string>();
    g.jalur.forEach(([lon, lat], jam) => {
      if (jam === 0) return;
      const w = cariWilayah(idx, lon, lat);
      if (!w || w.slug === g.asal || seen.has(w.slug)) return;
      seen.add(w.slug);
      (menuju[w.slug] ??= []).push({ gugus: g.id, jam, asal: g.asal });
    });
  }
  for (const k of Object.keys(menuju)) menuju[k].sort((a, b) => a.jam - b.jam);
  return {
    format: 'asap', updated_at: now.toISOString(), gugus, menuju,
    catatan: 'perkiraan kasar: lintasan mengikuti angin 10 m per jam (grid 1,5 derajat), tanpa naik-turun asap, hujan, atau medan',
  };
}
