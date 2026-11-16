/**
 * Walking tests with a portable PM2.5 sensor against the field per road (task F5-11). Pure functions; the command
 * line is scripts/field/validate-transect.mts and the protocol for students docs/PROTOKOL_JALAN_TEST.md.
 *
 * Steps: read the sensor CSV (Atmotube PRO 2 export: time, PM2.5, latitude, longitude; or a home-made logger: time,
 * pm25, with positions from a phone GPX track), drop everything within 150 m of the first and last positions (home
 * stays private), find the stops (>= 2 minutes within 30 m), give each stop its nearest road (<= 25 m) and road class,
 * pair consecutive stops on a small and a big road, and compare the measured difference with the model's.
 */
import type { RoadPack } from './pack.js';

export interface Sample { t: number; pm25: number; lat?: number; lon?: number }
export interface Stop { start: number; end: number; lat: number; lon: number; pm25: number; n: number }
export type RoadClass = 'kecil' | 'besar' | 'lain';

const M_LAT = 110574;
const dist = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  Math.hypot((aLon - bLon) * M_LAT * Math.cos((aLat * Math.PI) / 180), (aLat - bLat) * M_LAT);

/** Local clock text ("2026-11-20 07:15:00", "2026/11/20 07:15", "20/11/2026 07:15") or ISO with offset -> ms. */
export function parseTime(s: string, tzHours: number): number | null {
  const t = s.trim();
  if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(t)) { const v = Date.parse(t); return Number.isFinite(v) ? v : null; }
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
  let y, mo, d;
  if (m) { [y, mo, d] = [m[1], m[2], m[3]]; } else {
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (!m) return null;
    [d, mo, y] = [m[1], m[2], m[3]];
  }
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(m[4]) - tzHours, Number(m[5]), Number(m[6] ?? 0));
}

/** Sensor CSV with a header row; columns found by name (time/date, pm2.5/pm25, lat, lon/lng). */
export function parseSensorCsv(text: string, tzHours: number): Sample[] {
  const lines = text.replace(/^\s*/, '').split(/\r?\n/).filter((l) => l.trim()); // also strips a byte-order mark
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/["\s]/g, ''));
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const it = find(/^(date|time|timestamp|datetime|date&time|waktu)/), ip = find(/^pm2[._]?5/), ila = find(/^lat/), ilo = find(/^(lon|lng)/);
  if (it < 0 || ip < 0) throw new Error(`CSV needs a time and a PM2.5 column, found: ${head.join(', ')}`);
  const out: Sample[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const t = parseTime(c[it] ?? '', tzHours), pm = Number((c[ip] ?? '').replace(',', '.'));
    if (t === null || !Number.isFinite(pm) || pm < 0) continue;
    const lat = ila >= 0 ? Number(c[ila]) : NaN, lon = ilo >= 0 ? Number(c[ilo]) : NaN;
    out.push({ t, pm25: pm, ...(Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat, lon } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Track points of a GPX file (phone GPS logger). */
export function parseGpx(text: string): Array<{ t: number; lat: number; lon: number }> {
  const out: Array<{ t: number; lat: number; lon: number }> = [];
  for (const m of text.matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)) {
    const tm = /<time>([^<]+)<\/time>/.exec(m[3]);
    if (tm) out.push({ t: Date.parse(tm[1]), lat: Number(m[1]), lon: Number(m[2]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Samples without a position take the nearest track point within maxGapMs. */
export function attachPositions(samples: Sample[], track: Array<{ t: number; lat: number; lon: number }>, maxGapMs = 30_000): Sample[] {
  if (!track.length) return samples;
  let j = 0;
  return samples.map((s) => {
    if (s.lat !== undefined) return s;
    while (j + 1 < track.length && Math.abs(track[j + 1].t - s.t) <= Math.abs(track[j].t - s.t)) j++;
    return Math.abs(track[j].t - s.t) <= maxGapMs ? { ...s, lat: track[j].lat, lon: track[j].lon } : s;
  });
}

/** Drops samples without a position and those within radiusM of the first and last positions (home stays private). */
export function privacyTrim(samples: Sample[], radiusM = 150): Sample[] {
  const pos = samples.filter((s) => s.lat !== undefined);
  if (!pos.length) return [];
  const a = pos[0], b = pos[pos.length - 1];
  return pos.filter((s) => dist(s.lat!, s.lon!, a.lat!, a.lon!) > radiusM && dist(s.lat!, s.lon!, b.lat!, b.lon!) > radiusM);
}

/** Stops: runs of samples staying within radiusM of their first sample for at least minMs. */
export function findStops(samples: Sample[], radiusM = 30, minMs = 120_000): Stop[] {
  const out: Stop[] = [];
  let k = 0;
  while (k < samples.length) {
    const s0 = samples[k];
    let j = k;
    while (j + 1 < samples.length && dist(samples[j + 1].lat!, samples[j + 1].lon!, s0.lat!, s0.lon!) <= radiusM) j++;
    const run = samples.slice(k, j + 1);
    if (run[run.length - 1].t - run[0].t >= minMs) {
      out.push({
        start: run[0].t, end: run[run.length - 1].t, n: run.length,
        lat: run.reduce((s, x) => s + x.lat!, 0) / run.length, lon: run.reduce((s, x) => s + x.lon!, 0) / run.length,
        pm25: run.reduce((s, x) => s + x.pm25, 0) / run.length,
      });
    }
    k = j + 1;
  }
  return out;
}

const SMALL = new Set(['residential', 'living_street', 'service', 'unclassified', 'footway', 'path', 'pedestrian', 'track', 'steps']);
const BIG = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'trunk', 'trunk_link', 'motorway', 'motorway_link']);
export function roadClass(highway: string): RoadClass {
  return SMALL.has(highway) ? 'kecil' : BIG.has(highway) ? 'besar' : 'lain';
}

function segDist(lat: number, lon: number, a: number[], b: number[]): number {
  const kx = M_LAT * Math.cos((lat * Math.PI) / 180);
  const px = lon * kx, py = lat * M_LAT, ax = a[0] * kx, ay = a[1] * M_LAT, bx = b[0] * kx, by = b[1] * M_LAT;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(ax + u * dx - px, ay + u * dy - py);
}

/** Nearest road of the pack within maxM (a 0.002-degree grid over the road vertices keeps it fast). */
export function makeRoadIndex(pack: RoadPack) {
  const cell = 0.002;
  const grid = new Map<string, number[]>();
  for (let k = 0; k < pack.n; k++) {
    for (const [lon, lat] of pack.coords(k)) {
      const key = `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
      const g = grid.get(key) ?? [];
      if (g[g.length - 1] !== k) g.push(k);
      grid.set(key, g);
    }
  }
  return (lat: number, lon: number, maxM = 25): { k: number; distM: number } | null => {
    const cx = Math.floor(lon / cell), cy = Math.floor(lat / cell);
    let best: { k: number; distM: number } | null = null;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const c = pack.coords(k);
        for (let q = 1; q < c.length; q++) {
          const d = segDist(lat, lon, c[q - 1], c[q]);
          if (d <= maxM && (!best || d < best.distM)) best = { k, distM: d };
        }
      }
    }
    return best;
  };
}

export interface StopOnRoad extends Stop { road: { c: number; i: number; highway: string; klass: RoadClass; distM: number } }
export interface ModelAt { pm25: number; pm25_delta: number; no2: number; no2_delta: number }
export interface Pair { small: StopOnRoad; big: StopOnRoad; measured_diff: number; model_diff: number | null; model_no2_diff: number | null }

/** Consecutive stops, one on a small and one on a big road, within maxDistM and maxGapMs. */
export function pairStops(stops: StopOnRoad[], model: (s: StopOnRoad) => ModelAt | null, maxDistM = 300, maxGapMs = 15 * 60_000): Pair[] {
  const out: Pair[] = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k], b = stops[k + 1];
    const kinds = new Set([a.road.klass, b.road.klass]);
    if (!(kinds.has('kecil') && kinds.has('besar'))) continue;
    if (dist(a.lat, a.lon, b.lat, b.lon) > maxDistM || b.start - a.end > maxGapMs) continue;
    const small = a.road.klass === 'kecil' ? a : b, big = a.road.klass === 'kecil' ? b : a;
    const ms = model(small), mb = model(big);
    out.push({
      small, big, measured_diff: big.pm25 - small.pm25,
      model_diff: ms && mb ? mb.pm25 - ms.pm25 : null, model_no2_diff: ms && mb ? mb.no2 - ms.no2 : null,
    });
    k++; // each stop in at most one pair
  }
  return out;
}

/** Mean with a normal-approximation 95 % interval. */
export function meanCi(xs: number[]): { n: number; mean: number; ci95: [number, number] } | null {
  const n = xs.length;
  if (!n) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN;
  const h = n > 1 ? (1.96 * sd) / Math.sqrt(n) : NaN;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n, mean: r(mean), ci95: [r(mean - h), r(mean + h)] };
}
