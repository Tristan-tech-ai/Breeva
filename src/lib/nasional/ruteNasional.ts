/**
 * T9: walking routes outside the two pilot regions, computed on the phone in the national exhaust worker
 * (asapNasional.worker.ts, { type: 'rute' }). One worker for the page; its tiles stay cached per hour.
 */
import { fieldBase } from '../field/source';
import type { WalkRoute } from '../route/client';
import { meterAntara } from '../route/perjalanan';
import type { RuteReq } from '../../workers/asapNasional.worker';

/** Longest straight-line walk the phone routes outside the pilot regions (about 25 tiles of exhaust to compute). */
export const BATAS_JALAN_NASIONAL_KM = 6;
const INDONESIA = { s: -11, w: 95, n: 6, e: 141.2 };

/** What the route cards say outside the pilot regions: what the numbers lack. */
export const CATATAN_NASIONAL = 'Rute perkiraan di luar Badung–Denpasar dan Kota Bogor: jumlah kendaraan ditaksir dari jenis jalan (bukan hitungan per ruas), angin dari prakiraan, gang dan jalan setapak yang tidak ada di peta jalan nasional tidak ikut, dan belum ada alat ukur pinggir jalan di sini.';

export const diIndonesia = (p: { lat: number; lng: number }) => p.lat >= INDONESIA.s && p.lat <= INDONESIA.n && p.lng >= INDONESIA.w && p.lng <= INDONESIA.e;

/** Whether a walk from a to b can be routed here (both in Indonesia, not too far apart); else the reason in words. */
export function bolehRuteNasional(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { boleh: true } | { boleh: false; alasan: string } {
  if (!diIndonesia(a) || !diIndonesia(b)) return { boleh: false, alasan: 'Rute di perangkat hanya untuk wilayah Indonesia.' };
  const km = meterAntara(a, b) / 1000;
  if (km > BATAS_JALAN_NASIONAL_KM) return { boleh: false, alasan: `Rute jalan kaki di luar wilayah pilot paling jauh ${BATAS_JALAN_NASIONAL_KM} km (titikmu ${km.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km).` };
  return { boleh: true };
}

let worker: Worker | null = null;
let seq = 0;

/** Routes from a to b at this hour; progress(selesai, total) while the tiles' exhaust is computed. */
export function ruteNasional(a: { lat: number; lng: number }, b: { lat: number; lng: number }, progres?: (selesai: number, total: number) => void): Promise<{ routes: WalkRoute[]; ms: number; ubin: number }> {
  worker ??= new Worker(new URL('../../workers/asapNasional.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++seq;
  const now = new Date();
  const msg: RuteReq = {
    type: 'rute', id, base: fieldBase(), from: a, to: b,
    hourLocal: (now.getUTCHours() + Math.round(a.lng / 15) + 24) % 24, hourKey: now.toISOString().slice(0, 13),
  };
  return new Promise((resolve, reject) => {
    const dengar = (ev: MessageEvent<{ id: number; type?: string; selesai?: number; total?: number; routes?: WalkRoute[]; ms?: number; ubin?: number; galat?: string }>) => {
      const d = ev.data;
      if (d.id !== id) return;
      if (d.type === 'progres') { progres?.(d.selesai ?? 0, d.total ?? 0); return; }
      if (d.type !== 'rute') return;
      w.removeEventListener('message', dengar);
      if (d.galat) reject(new Error(d.galat));
      else resolve({ routes: d.routes ?? [], ms: d.ms ?? 0, ubin: d.ubin ?? 0 });
    };
    w.addEventListener('message', dengar);
    w.postMessage(msg);
  });
}
