/**
 * N-40: pure parts of the /pantau map, drawn on canvas (a phone lagged on zoom when ~2,800 SVG shapes and 384 DOM wind
 * markers were redrawn; measured with .claude/loop/lag_ukur.mjs): marker styles and texts, the wind arrows of one hour,
 * and the arrow geometry in screen pixels.
 */
import type { FirePoint } from './firms';
import { gridPoints, type WindFile } from './angin';
import { formatAngka } from '../angka';

export interface Gaya { color: string; weight: number; fillColor: string; fillOpacity: number }

/** A fire outside Indonesia (no kab/kota) is grey when `luar` is on; otherwise red (high confidence) or orange. */
export function gayaApi(f: FirePoint, luar: boolean): Gaya {
  return luar && !f[6] ? { color: '#475569', weight: 1, fillColor: '#94a3b8', fillOpacity: 0.7 }
    : { color: '#b91c1c', weight: 1, fillColor: f[3] === 'h' ? '#dc2626' : '#f97316', fillOpacity: 0.75 };
}

export function radiusApi(f: FirePoint): number {
  return Math.min(9, 2.5 + Math.sqrt(Math.max(0, f[2])) / 2);
}

const KEYAKINAN: Record<string, string> = { h: 'tinggi', n: 'sedang', l: 'rendah' };
export function teksApi(f: FirePoint, luar: boolean): string {
  return `${luar && !f[6] ? 'Di luar Indonesia · ' : ''}Titik api ${f[4].replace('T', ' ').replace('Z', ' UTC')} · daya ${formatAngka(f[2], 0, 3)} MW · keyakinan ${KEYAKINAN[f[3]] ?? f[3]}`;
}

export interface Panah { lat: number; lon: number; from: number; speed: number }

/** The wind arrows of one hour of the file (points without a value left out). */
export function panahAngin(wind: WindFile | null, hour: number): Panah[] {
  if (!wind) return [];
  const out: Panah[] = [];
  gridPoints().forEach(([lon, lat], k) => {
    const speed = wind.speed[k]?.[hour], from = wind.dir[k]?.[hour];
    if (speed == null || from == null || speed < 0 || from < 0) return;
    out.push({ lat, lon, from, speed });
  });
  return out;
}

/** Arrow outline (shaft and head) of length `len` px centred on (x, y), pointing where the wind blows TO (from + 180
 * degrees, compass bearing: 0 = north = up the screen). */
export function bentukPanah(x: number, y: number, from: number, len = 14): Array<[number, number]> {
  const a = ((from + 180) % 360) * (Math.PI / 180);
  const dx = Math.sin(a), dy = -Math.cos(a); // screen y grows downwards
  const tip: [number, number] = [x + (dx * len) / 2, y + (dy * len) / 2];
  const tail: [number, number] = [x - (dx * len) / 2, y - (dy * len) / 2];
  const h = len * 0.4, px = -dy, py = dx;
  return [tail, tip, [tip[0] - dx * h + px * h * 0.6, tip[1] - dy * h + py * h * 0.6], tip, [tip[0] - dx * h - px * h * 0.6, tip[1] - dy * h - py * h * 0.6]];
}

/** Arrow opacity grows with the wind speed (as the earlier SVG arrows). */
export function opasitasPanah(speed: number): number {
  return Math.min(0.9, 0.35 + speed / 12);
}
