import { useEffect } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import { opacityFor, trafficColor, weightFor } from '../../lib/roadColors';
import { inPilot, KODE_KELAS, LABEL_ASAP_NASIONAL, NATIONAL_MIN_ZOOM } from '../../lib/nasional/ubinView';
import { gambarAsap, pusatUbin, siapkanUbin, UBIN_ASAP_Z, ubinInduk, type UbinSiap } from '../../lib/nasional/gambarAsap';
import { UBIN_HEMAT } from '../../lib/mapPerf';
import type { AsapReq, AsapTile } from '../../workers/asapNasional.worker';

/** Computed tiles kept in memory for the hour (a screen needs about a dozen; panning back must not recompute). */
const SIMPAN = 96;

/** The grid layer: one canvas per map tile, drawn from the computed z14 tiles it needs (gambarAsap.ts). */
function lapisanAsap(minta: (x: number, y: number) => Promise<UbinSiap>, gaya: Parameters<typeof gambarAsap>[5], hidup: () => boolean): L.GridLayer {
  const Lapisan = L.GridLayer.extend({
    createTile(this: L.GridLayer, coords: L.Coords, done: L.DoneCallback) {
      const size = this.getTileSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = L.DomUtil.create('canvas') as HTMLCanvasElement;
      c.width = size.x * dpr; c.height = size.y * dpr;
      c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
      // a pilot region draws its own roads there (the field layer): no second set of lines on top
      const induk = ubinInduk(coords.z, coords.x, coords.y).filter(([x, y]) => { const [lat, lon] = pusatUbin(x, y); return !inPilot(lat, lon); });
      if (!induk.length) { setTimeout(() => done(undefined, c), 0); return c; }
      Promise.all(induk.map(([x, y]) => minta(x, y))).then((ubin) => {
        const ctx = c.getContext('2d');
        if (ctx && hidup()) gambarAsap(ctx, ubin, coords, size.x, dpr, gaya);
        done(undefined, c);
      }, (e: Error) => done(e, c));
      return c;
    },
  });
  return new (Lapisan as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({ minZoom: NATIONAL_MIN_ZOOM, maxZoom: 22, pane: 'overlayPane', ...UBIN_HEMAT });
}

/**
 * N-21: outside the pilot regions, at zoom 13 and closer, colour roads by vehicle exhaust computed on the phone (worker),
 * with a plain-words note (M-U15). M-U16: drawn on canvas tiles of a grid layer with the width and opacity of the pilot
 * roads of the same class and zoom (lib/nasional/gambarAsap.ts), instead of one Leaflet polyline per road. A z14 tile
 * whose centre lies in a pilot region is left to the pilot's own field layer. `onState` reports what is shown.
 */
export function useNationalExhaust(map: L.Map | null, enabled: boolean, onState?: (s: { aktif: boolean; ubin: number; ms: number[] }) => void) {
  useEffect(() => {
    if (!map || !enabled) return;
    const workers: Worker[] = [];
    const siap = new Map<string, UbinSiap>();
    const tunggu = new Map<string, { janji: Promise<UbinSiap>; jadi: (u: UbinSiap) => void }>();
    const ms: number[] = [];
    let antre: Array<[number, number, number]> = [];
    let terjadwal = false, idReq = 0, hidup = true;

    const label = new L.Control({ position: 'bottomright' });
    let labelEl: HTMLElement | null = null;
    label.onAdd = () => {
      const d = L.DomUtil.create('div', 'breeva-indikatif');
      labelEl = d;
      d.setAttribute('data-asap-nasional', '');
      d.style.cssText = 'background:#fffbeb;color:#78350f;border-radius:9999px;padding:2px 8px;font:600 11px system-ui;box-shadow:0 1px 2px rgba(0,0,0,.15)';
      d.textContent = LABEL_ASAP_NASIONAL;
      return d;
    };
    let labelOn = false;

    // the place's solar hour (WIB/WITA/WIT alike) and the hour the result is kept under
    const jam = () => {
      const now = new Date(), c = map.getCenter();
      return { hourLocal: (now.getUTCHours() + Math.round(c.lng / 15) + 24) % 24, hourKey: now.toISOString().slice(0, 13) };
    };
    const terima = (ev: MessageEvent<{ id: number; tile?: AsapTile; done?: boolean }>) => {
      const t = ev.data.tile;
      if (!t || !hidup) return;
      const u = siapkanUbin(t);
      siap.set(t.key, u);
      if (siap.size > SIMPAN) siap.delete(siap.keys().next().value as string);
      ms.push(Math.round(t.ms));
      tunggu.get(t.key)?.jadi(u);
      tunggu.delete(t.key);
      // what was drawn and how long each tile took, for the speed check (data-ubin, data-ms)
      if (labelEl) { labelEl.dataset.ubin = String(siap.size); labelEl.dataset.ms = ms.join(','); }
      onState?.({ aktif: true, ubin: siap.size, ms });
    };
    const kirim = () => {
      terjadwal = false;
      if (!hidup || !antre.length) return;
      // two workers on phones with the cores for it: the tiles of a screen are computed side by side
      const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
      while (workers.length < n) {
        const w = new Worker(new URL('../../workers/asapNasional.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = terima;
        workers.push(w);
      }
      const { hourLocal, hourKey } = jam();
      const semua = antre; antre = [];
      workers.forEach((w, j) => {
        const bagian = semua.filter((_, i) => i % workers.length === j);
        if (bagian.length) w.postMessage({ id: ++idReq, base: fieldBase(), tiles: bagian, hourLocal, hourKey } satisfies AsapReq);
      });
    };
    /** The computed z14 tile x/y of this hour: from memory, on its way, or asked from a worker with the others of this tick. */
    const minta = (x: number, y: number): Promise<UbinSiap> => {
      const key = `${UBIN_ASAP_Z}/${x}/${y}@${jam().hourKey}`;
      const ada = siap.get(key);
      if (ada) return Promise.resolve(ada);
      let t = tunggu.get(key);
      if (!t) {
        let jadi!: (u: UbinSiap) => void;
        const janji = new Promise<UbinSiap>((r) => { jadi = r; });
        t = { janji, jadi };
        tunggu.set(key, t);
        antre.push([UBIN_ASAP_Z, x, y]);
        if (!terjadwal) { terjadwal = true; setTimeout(kirim, 0); }
      }
      return t.janji;
    };
    const gaya = (kelas: number, nox: number, z: number) => {
      const hw = KODE_KELAS[kelas] ?? 'residential';
      return { color: trafficColor('no2', nox), weight: weightFor(hw, z), opacity: opacityFor(hw, z, 0.9) };
    };

    const layer = lapisanAsap(minta, gaya, () => hidup);
    layer.addTo(map);

    const perbarui = () => {
      const c = map.getCenter();
      const aktif = map.getZoom() >= NATIONAL_MIN_ZOOM && !inPilot(c.lat, c.lng);
      if (aktif && !labelOn) { label.addTo(map); labelOn = true; }
      if (!aktif && labelOn) { label.remove(); labelOn = false; labelEl = null; onState?.({ aktif: false, ubin: 0, ms }); }
    };
    map.on('moveend', perbarui);
    perbarui();
    return () => {
      hidup = false;
      map.off('moveend', perbarui);
      layer.remove();
      if (labelOn) label.remove();
      workers.forEach((w) => w.terminate());
    };
  }, [map, enabled, onState]);
}
