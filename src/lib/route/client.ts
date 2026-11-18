/** Promise API over the route worker (src/workers/route.worker.ts). */
import { fieldBase } from '../field/source';

export interface WalkRoute {
  lengthM: number; timeS: number; pm25Mean: number; no2Mean: number; coords: Array<[number, number]>; w: number;
  /** Mean vehicle exhaust along the route: the traffic part as the NOx tracer, ug/m3 (absent from older workers). */
  exhMean?: number;
  /** Local hour of the exhaust forecast the route was computed with; null = the field run's own hour. */
  forecastHour?: number | null;
  /** Last route of a departure now: its mean exhaust if leaving in the next hours instead. */
  soon?: Array<{ local_hour: number; ahead: number; exhMean: number }>;
  /** Motor routes: 'dua-angka' (own + imposed exposure in the cost) or 'darurat' (fastest, no points). */
  kind?: 'dua-angka' | 'darurat';
  /** Mean harga hirup along the route (1 = the region's median road): the exposure the trip imposes. */
  hargaMean?: number;
  /** Motor routes: school zone off (outside school hours or no school data), kept, or lifted near the trip's ends. */
  school?: 'off' | 'kept' | 'lifted-near-ends';
  /** Motor routes while the school zone is on: this route against the same kind of route without the zone. */
  schoolCost?: { extraM: number; extraS: number; changed: boolean };
  /** Motor 'dua-angka' route: the emergency (fastest) search found this same route, so only one card is shown. */
  sameAsFastest?: boolean;
}

export type SoonHours = NonNullable<WalkRoute['soon']>;

/** The routes with the leave-later hours on the last (cleanest) route, as the worker sends them after the routes. */
export function withSoon(routes: WalkRoute[], soon: SoonHours | null | undefined): WalkRoute[] {
  if (!routes.length || !soon?.length) return routes;
  return routes.map((r, k) => (k === routes.length - 1 ? { ...r, soon } : r));
}

export class RouteClient {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private readonly soonWaiters = new Map<number, (soon: SoonHours) => void>();
  private readonly progress = new Map<number, (bytes: number) => void>();
  private readonly shapeWaiters = new Map<number, (coords: Array<Array<[number, number]>>) => void>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/route.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const id = ev.data.id;
      if (ev.data.type === 'progress') { this.progress.get(id)?.(ev.data.bytes); return; }
      if (ev.data.type === 'shapes') {
        const w = this.shapeWaiters.get(id);
        this.shapeWaiters.delete(id);
        if (w && ev.data.ok) w(ev.data.coords);
        return;
      }
      if (ev.data.type === 'soon') {
        const w = this.soonWaiters.get(id);
        this.soonWaiters.delete(id);
        if (w && ev.data.ok) w(ev.data.soon ?? []);
        return;
      }
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      this.progress.delete(id);
      if (!ev.data.soonPending) this.soonWaiters.delete(id);
      if (!ev.data.shapesPending) this.shapeWaiters.delete(id);
      if (ev.data.ok) p.ok(ev.data); else p.fail(new Error(ev.data.error));
    };
  }

  private call<T>(msg: Record<string, unknown>, onSoon?: (soon: SoonHours) => void, onProgress?: (bytes: number) => void,
    onShapes?: (coords: Array<Array<[number, number]>>) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail });
      if (onSoon) this.soonWaiters.set(id, onSoon);
      if (onProgress) this.progress.set(id, onProgress);
      if (onShapes) this.shapeWaiters.set(id, onShapes);
      this.worker.postMessage({ id, ...msg });
    });
  }

  /** onProgress receives the encoded size of the files being downloaded while the region loads (X-W4). */
  /** departLocal: the departure a route link asks for, so its forecast file comes down with the region (F1-64) */
  init(region: { name: string; geometry: string }, base = fieldBase(), onProgress?: (bytes: number) => void, departLocal?: string | null) {
    return this.call<{ nodes: number; edges: number; run: string }>({ type: 'init', base, region, departLocal }, undefined, onProgress);
  }

  /**
   * departLocal: departure as local clock time "HH:MM" in the region (default now); it decides whether the school zone
   * is active. onSoon receives the leave-later hours of the last route when they arrive after the routes (departure now).
   */
  route(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walk' | 'motor' = 'walk', departLocal?: string | null,
    onSoon?: (soon: SoonHours) => void, onShapes?: (coords: Array<Array<[number, number]>>) => void) {
    return this.call<{ routes: WalkRoute[]; ms: number; run: string; soonPending?: boolean; shapesPending?: boolean }>({ type: 'route', from, to, mode, departLocal }, onSoon, undefined, onShapes);
  }

  terminate() { this.worker.terminate(); }
}
