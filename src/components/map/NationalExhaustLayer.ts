import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fieldBase } from '../../lib/field/source';
import { trafficColor } from '../../lib/roadColors';
import { inPilot, NATIONAL_MIN_ZOOM, viewTiles } from '../../lib/nasional/ubinView';
import type { AsapReq, AsapTile } from '../../workers/asapNasional.worker';

/**
 * N-21: outside the pilot regions, at zoom 13 and closer, colour roads by vehicle exhaust computed on the phone (worker),
 * labelled indicative. `onState` reports what is shown (for the label and tests).
 */
export function useNationalExhaust(map: L.Map | null, enabled: boolean, onState?: (s: { aktif: boolean; ubin: number; ms: number[] }) => void) {
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    if (!map || !enabled) return;
    const layer = L.layerGroup().addTo(map);
    const renderer = L.canvas({ padding: 0.2 });
    const drawn = new Set<string>();
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
      if (!aktif) {
        if (labelOn) { label.remove(); labelOn = false; }
        onState?.({ aktif: false, ubin: drawn.size, ms });
        return;
      }
      if (!labelOn) { label.addTo(map); labelOn = true; }
      const b = map.getBounds();
      const now = new Date();
      const hourLocal = (now.getUTCHours() + Math.round(c.lng / 15) + 24) % 24; // the place's solar hour, WIB/WITA/WIT alike
      const hourKey = now.toISOString().slice(0, 13);
      const want = viewTiles({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, { lon: c.lng, lat: c.lat })
        .filter(([tz, x, y]) => !drawn.has(`${tz}/${x}/${y}@${hourKey}`));
      if (!want.length) return;
      workerRef.current ??= new Worker(new URL('../../workers/asapNasional.worker.ts', import.meta.url), { type: 'module' });
      const w = workerRef.current;
      const id = ++req;
      w.onmessage = (ev: MessageEvent<{ id: number; tile?: AsapTile; done?: boolean }>) => {
        if (ev.data.id !== id || !ev.data.tile) return;
        const t = ev.data.tile;
        drawn.add(t.key);
        ms.push(Math.round(t.ms));
        for (let i = 0; i + 1 < t.offs.length; i++) {
          const pts: L.LatLngExpression[] = [];
          for (let o = t.offs[i]; o < t.offs[i + 1]; o++) pts.push([t.coords[2 * o + 1], t.coords[2 * o]]);
          L.polyline(pts, { renderer, color: trafficColor('no2', t.nox[i]), weight: t.k[i] <= 3 ? 4 : t.k[i] <= 5 ? 3 : 2, opacity: 0.85, interactive: false }).addTo(layer);
        }
        // what was drawn and how long each tile took, for the speed check (data-ubin, data-ms)
        if (labelEl) { labelEl.dataset.ubin = String(drawn.size); labelEl.dataset.ms = ms.join(','); }
        onState?.({ aktif: true, ubin: drawn.size, ms });
      };
      const msg: AsapReq = { id, base: fieldBase(), tiles: want, hourLocal, hourKey };
      w.postMessage(msg);
    };
    map.on('moveend', update);
    update();
    return () => {
      map.off('moveend', update);
      layer.remove();
      if (labelOn) label.remove();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [map, enabled, onState]);
}
