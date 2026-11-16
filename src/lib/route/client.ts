/** Promise API over the route worker (src/workers/route.worker.ts). */
import { fieldBase } from '../field/source';

export interface WalkRoute {
  lengthM: number; timeS: number; pm25Mean: number; no2Mean: number; coords: Array<[number, number]>; w: number;
  /** Motor routes: 'dua-angka' (own + imposed exposure in the cost) or 'darurat' (fastest, no points). */
  kind?: 'dua-angka' | 'darurat';
  /** Mean harga hirup along the route (1 = the region's median road): the exposure the trip imposes. */
  hargaMean?: number;
}

export class RouteClient {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/route.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.ok(ev.data); else p.fail(new Error(ev.data.error));
    };
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
      this.worker.postMessage({ id, ...msg });
    });
  }

  init(region: { name: string; geometry: string }, base = fieldBase()) {
    return this.call<{ nodes: number; edges: number; run: string }>({ type: 'init', base, region });
  }

  route(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walk' | 'motor' = 'walk') {
    return this.call<{ routes: WalkRoute[]; ms: number; run: string }>({ type: 'route', from, to, mode });
  }

  terminate() { this.worker.terminate(); }
}
