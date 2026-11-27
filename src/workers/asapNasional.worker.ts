/// <reference lib="webworker" />
/**
 * N-21: exhaust per road outside the pilot regions, computed on the phone. Reads z14 tiles of the national road
 * PMTiles (with their 8 neighbours as sources), runs the pilot kernel at the local hour with the national wind, and
 * keeps each tile's result per hour in IndexedDB so a second visit in the same hour draws at once.
 *
 * T9: also walking routes anywhere in Indonesia ({ type: 'rute' }): the tiles around start and destination, a walking
 * graph built from them (lib/nasional/grafNasional.ts), and the same route search as the pilot regions (fastest, and the
 * least exhaust within the time budget). Replies { id, type: 'progres', selesai, total } while tiles are computed, then
 * { id, type: 'rute', routes, ms, ubin } or { id, type: 'rute', galat }.
 */
import { PMTiles } from 'pmtiles';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { decodeLines, tileOf, type MvtLine } from '../lib/nasional/mvt';
import { asapUbin } from '../lib/nasional/asapRuas';
import type { WindFile } from '../lib/nasional/angin';
import { bangunGraf, simpulTerdekat } from '../lib/nasional/grafNasional';
import { walkExhaust, walkRoutes, WALK_SPEED } from '../lib/route/walkExhaust';
import type { WalkGraph } from '../lib/route/walkGraph';
import type { WalkRoute } from '../lib/route/client';

export interface AsapReq { id: number; base: string; tiles: Array<[number, number, number]>; hourLocal: number; hourKey: string }
export interface AsapTile { key: string; coords: Float32Array; offs: Uint32Array; nox: Float32Array; k: Uint8Array; ms: number; cache: boolean }
export interface RuteReq {
  type: 'rute'; id: number; base: string; hourLocal: number; hourKey: string;
  from: { lat: number; lng: number }; to: { lat: number; lng: number };
}
/** Most z14 tiles a route may need (a 6 km walk with its margin fits in about 25). */
export const MAKS_UBIN_RUTE = 42;
/** Margin around start and destination, degrees (about 700 m), so a route may bend around a block. */
const TEPI = 0.0065;

let pm: PMTiles | null = null;
let windP: Promise<WindFile | null> | null = null;
const tiles = new Map<string, Promise<MvtLine[]>>();
type Saved = Omit<AsapTile, 'cache' | 'ms'>;
interface AsapDB extends DBSchema { ubin: { key: string; value: Saved } }
let db: Promise<IDBPDatabase<AsapDB>> | null = null;
// the tile key (z/x/y@hour) is the record's own key path
const store = () => (db ??= openDB<AsapDB>('breeva-asap-nasional', 1, { upgrade: (d) => { d.createObjectStore('ubin', { keyPath: 'key' }); } }));

function tile(z: number, x: number, y: number): Promise<MvtLine[]> {
  const key = `${z}/${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = pm!.getZxy(z, x, y).then((r) => (r ? decodeLines(new Uint8Array(r.data), 'jalan', z, x, y) : [])).catch(() => []);
    tiles.set(key, p);
  }
  return p;
}

function windHour(w: WindFile | null): number {
  if (!w?.hours.length) return 0;
  let best = 0;
  w.hours.forEach((h, i) => { if (Math.abs(Date.parse(h) - Date.now()) < Math.abs(Date.parse(w.hours[best]) - Date.now())) best = i; });
  return best;
}

function siapkan(base: string) {
  pm ??= new PMTiles(`${base}/tiles/jalan/2026-11/indonesia_jalan.pmtiles`);
  windP ??= fetch(`${base}/v/nasional/angin.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

/** Exhaust of the roads of one z14 tile at this hour: from IndexedDB when computed before, else computed and kept. */
async function hitungUbin(z: number, x: number, y: number, hourLocal: number, hourKey: string): Promise<AsapTile> {
  const t0 = performance.now();
  const key = `${z}/${x}/${y}@${hourKey}`;
  try {
    const hit = await (await store()).get('ubin', key);
    if (hit) return { ...(hit as Saved), ms: performance.now() - t0, cache: true };
  } catch { /* private mode: compute */ }
  const wind = await windP;
  const centre = await tile(z, x, y);
  const around = await Promise.all([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => tile(z, x + dx, y + dy)));
  const r = asapUbin(centre, around.flat(), hourLocal, wind, windHour(wind));
  const n = r.reduce((a, s) => a + s.coords.length, 0);
  const coords = new Float32Array(n * 2), offs = new Uint32Array(r.length + 1), nox = new Float32Array(r.length), k = new Uint8Array(r.length);
  let o = 0;
  r.forEach((s, i) => { offs[i] = o; for (const [lon, lat] of s.coords) { coords[2 * o] = lon; coords[2 * o + 1] = lat; o++; } nox[i] = s.nox; k[i] = s.k; });
  offs[r.length] = o;
  const out: AsapTile = { key, coords, offs, nox, k, ms: performance.now() - t0, cache: false };
  try { await (await store()).put('ubin', { key, coords, offs, nox, k }); } catch { /* not kept */ }
  return out;
}

/** The z14 tiles a walk from a to b needs: the box of both ends with a margin. */
export function ubinRute(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Array<[number, number, number]> {
  const [x0, y0] = tileOf(Math.min(a.lng, b.lng) - TEPI, Math.max(a.lat, b.lat) + TEPI, 14);
  const [x1, y1] = tileOf(Math.max(a.lng, b.lng) + TEPI, Math.min(a.lat, b.lat) - TEPI, 14);
  const out: Array<[number, number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([14, x, y]);
  return out;
}

async function rute(q: RuteReq) {
  const t0 = performance.now();
  siapkan(q.base);
  const daftar = ubinRute(q.from, q.to);
  if (daftar.length > MAKS_UBIN_RUTE) throw new Error('titik berangkat dan tujuan terlalu jauh untuk rute jalan kaki');
  const ubin: AsapTile[] = [];
  for (const [z, x, y] of daftar) {
    ubin.push(await hitungUbin(z, x, y, q.hourLocal, q.hourKey));
    (self as unknown as Worker).postMessage({ id: q.id, type: 'progres', selesai: ubin.length, total: daftar.length });
  }
  const g = bangunGraf(ubin);
  const s = simpulTerdekat(g, q.from.lat, q.from.lng), t = simpulTerdekat(g, q.to.lat, q.to.lng);
  if (s < 0 || t < 0) throw new Error('titik di luar jaringan jalan (lebih dari 300 m dari jalan)');
  const wg = g as unknown as WalkGraph;
  const rs = walkRoutes(wg, s, t, g.nox);
  const xOf = walkExhaust(g.nox);
  const routes: WalkRoute[] = rs.map((r) => {
    let dosis = 0, waktu = 0;
    for (const e of r.edges) { const tS = g.lenDm[e] / 10 / WALK_SPEED; waktu += tS; dosis += xOf(e) * tS; }
    const exh = waktu > 0 ? dosis / waktu : 0;
    return { lengthM: Math.round(r.lengthM), timeS: Math.round(r.timeS), pm25Mean: Number.NaN, no2Mean: exh, exhMean: exh,
      coords: r.nodes.map((u) => [g.lon[u], g.lat[u]] as [number, number]), w: r.w, forecastHour: null };
  });
  return { routes, ms: performance.now() - t0, ubin: daftar.length };
}

self.onmessage = async (ev: MessageEvent<AsapReq | RuteReq>) => {
  if ((ev.data as RuteReq).type === 'rute') {
    const q = ev.data as RuteReq;
    try { (self as unknown as Worker).postMessage({ id: q.id, type: 'rute', ...(await rute(q)) }); }
    catch (e) { (self as unknown as Worker).postMessage({ id: q.id, type: 'rute', galat: (e as Error).message }); }
    return;
  }
  const { id, base, hourLocal, hourKey } = ev.data as AsapReq;
  siapkan(base);
  for (const [z, x, y] of (ev.data as AsapReq).tiles) {
    const out = await hitungUbin(z, x, y, hourLocal, hourKey);
    if (out.cache) (self as unknown as Worker).postMessage({ id, tile: out });
    else (self as unknown as Worker).postMessage({ id, tile: out }, [out.coords.buffer, out.offs.buffer, out.nox.buffer, out.k.buffer]);
  }
  (self as unknown as Worker).postMessage({ id, done: true });
};
