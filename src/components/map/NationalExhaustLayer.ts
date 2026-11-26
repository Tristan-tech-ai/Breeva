import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import { trafficColor } from '../../lib/roadColors';
import { inPilot, NATIONAL_MIN_ZOOM, ubinLuarPandang, viewTiles } from '../../lib/nasional/ubinView';
import type { AsapReq, AsapTile } from '../../workers/asapNasional.worker';

/**
 * N-21: outside the pilot regions, at zoom 13 and closer, colour roads by vehicle exhaust computed on the phone (worker),
 * labelled indicative. `onState` reports what is shown (for the label and tests).
 */
export function useNationalExhaust(map: L.Map | null, enabled: boolean, onState?: (s: { aktif: boolean; ubin: number; ms: number[] }) => void) {
  const workerRef = useRef<Worker[]>([]);
  useEffect(() => {
    if (!map || !enabled) return;
    const layer = L.layerGroup().addTo(map);
    const renderer = L.canvas({ padding: 0.2 });
    // M-U02: one group per tile, so tiles that leave the view (or every tile, when zoomed out below the threshold) are
    // removed from the canvas instead of staying under the next view
    const drawn = new Map<string, L.LayerGroup>();
    let aktifNow = false;
    let req = 0;
    const ms: number[] = [];
    const label = new L.Control({ position: 'bottomright' });
    let labelEl: HTMLElement | null = null;
    label.onAdd = () => {
      const d = L.DomUtil.create('div', 'breeva-indikatif');
      labelEl = d;
      d.setAttribute('data-asap-nasional', '');
      d.style.cssText = 'background:#fffbeb;color:#78350f;border-radius:9999px;padding:2px 8px;font:600 11px system-ui;box-shadow:0 1px 2px rgba(0,0,0,.15)';
      d.textContent = 'Asap kendaraan di ponsel: indikatif';
      return d;
    };
    let labelOn = false;
    const update = () => {
      const z = map.getZoom(), c = map.getCenter();
      const aktif = z >= NATIONAL_MIN_ZOOM && !inPilot(c.lat, c.lng);
      aktifNow = aktif;
      if (!aktif) {
        if (labelOn) { label.remove(); labelOn = false; }
        for (const g of drawn.values()) g.remove();
        drawn.clear();
        req++; // tiles still on their way belong to a view that is gone
        onState?.({ aktif: false, ubin: 0, ms });
        return;
      }
      if (!labelOn) { label.addTo(map); labelOn = true; }
      const b = map.getBounds();
      const now = new Date();
      const hourLocal = (now.getUTCHours() + Math.round(c.lng / 15) + 24) % 24; // the place's solar hour, WIB/WITA/WIT alike
      const hourKey = now.toISOString().slice(0, 13);
      const inView = viewTiles({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, { lon: c.lng, lat: c.lat });
      const viewKeys = new Set(inView.map(([tz, x, y]) => `${tz}/${x}/${y}@${hourKey}`));
      for (const k of ubinLuarPandang(drawn.keys(), viewKeys)) { drawn.get(k)?.remove(); drawn.delete(k); }
      const want = inView.filter(([tz, x, y]) => !drawn.has(`${tz}/${x}/${y}@${hourKey}`));
      if (!want.length) return;
      // two workers on phones with the cores for it: the tiles of a screen are computed side by side
      const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
      while (workerRef.current.length < n) workerRef.current.push(new Worker(new URL('../../workers/asapNasional.worker.ts', import.meta.url), { type: 'module' }));
      const id = ++req;
      const onTile = (ev: MessageEvent<{ id: number; tile?: AsapTile; done?: boolean }>) => {
        if (ev.data.id !== id || !ev.data.tile || !aktifNow) return;
        const t = ev.data.tile;
        if (drawn.has(t.key)) return;
        const group = L.layerGroup().addTo(layer);
        drawn.set(t.key, group);
        ms.push(Math.round(t.ms));
        for (let i = 0; i + 1 < t.offs.length; i++) {
          const pts: L.LatLngExpression[] = [];
          for (let o = t.offs[i]; o < t.offs[i + 1]; o++) pts.push([t.coords[2 * o + 1], t.coords[2 * o]]);
          L.polyline(pts, { renderer, color: trafficColor('no2', t.nox[i]), weight: t.k[i] <= 3 ? 4 : t.k[i] <= 5 ? 3 : 2, opacity: 0.85, interactive: false }).addTo(group);
        }
        // what was drawn and how long each tile took, for the speed check (data-ubin, data-ms)
        if (labelEl) { labelEl.dataset.ubin = String(drawn.size); labelEl.dataset.ms = ms.join(','); }
        onState?.({ aktif: true, ubin: drawn.size, ms });
      };
      workerRef.current.forEach((w, j) => {
        w.onmessage = onTile;
        const part = want.filter((_, i) => i % workerRef.current.length === j);
        if (part.length) w.postMessage({ id, base: fieldBase(), tiles: part, hourLocal, hourKey } satisfies AsapReq);
      });
    };
    map.on('moveend', update);
    update();
    return () => {
      map.off('moveend', update);
      layer.remove();
      if (labelOn) label.remove();
      workerRef.current.forEach((w) => w.terminate());
      workerRef.current = [];
    };
  }, [map, enabled, onState]);
}
