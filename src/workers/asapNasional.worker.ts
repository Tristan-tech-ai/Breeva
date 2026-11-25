/// <reference lib="webworker" />
/**
 * N-21: exhaust per road outside the pilot regions, computed on the phone. Reads z14 tiles of the national road
 * PMTiles (with their 8 neighbours as sources), runs the pilot kernel at the local hour with the national wind, and
 * keeps each tile's result per hour in IndexedDB so a second visit in the same hour draws at once.
 */
import { PMTiles } from 'pmtiles';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { decodeLines, type MvtLine } from '../lib/nasional/mvt';
import { asapUbin } from '../lib/nasional/asapRuas';
import type { WindFile } from '../lib/nasional/angin';

export interface AsapReq { id: number; base: string; tiles: Array<[number, number, number]>; hourLocal: number; hourKey: string }
export interface AsapTile { key: string; coords: Float32Array; offs: Uint32Array; nox: Float32Array; k: Uint8Array; ms: number; cache: boolean }

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

self.onmessage = async (ev: MessageEvent<AsapReq>) => {
  const { id, base, hourLocal, hourKey } = ev.data;
  pm ??= new PMTiles(`${base}/tiles/jalan/2026-11/indonesia_jalan.pmtiles`);
  windP ??= fetch(`${base}/v/nasional/angin.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const wind = await windP;
  for (const [z, x, y] of ev.data.tiles) {
    const t0 = performance.now();
    const key = `${z}/${x}/${y}@${hourKey}`;
    try {
      const hit = await (await store()).get('ubin', key);
      if (hit) { (self as unknown as Worker).postMessage({ id, tile: { ...hit, ms: performance.now() - t0, cache: true } }); continue; }
    } catch { /* private mode: compute */ }
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
    (self as unknown as Worker).postMessage({ id, tile: out }, [coords.buffer, offs.buffer, nox.buffer, k.buffer]);
  }
  (self as unknown as Worker).postMessage({ id, done: true });
};
