import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { aqiBand, CONTRAST_FALLBACK, DELTA_STOPS, lerpColor, TOTAL_STOPS, weightFor } from '../../lib/roadColors';

// Road-color layer: PostGIS-generated Mapbox Vector Tiles (/api/tiles/road-mvt)
// rendered as a NATIVE Leaflet layer via Leaflet.VectorGrid (Canvas). Because the
// vector tiles are a true Leaflet GridLayer, they pan/zoom *as* the base map — no
// separate GL map, so they can never desync/offset (the failure mode of the prior
// maplibre-gl-leaflet bridge). Crisp at every zoom (vector overzoom), CDN-cached,
// every property in one tile so color modes switch with a cheap redraw().

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function colorFor(props: any, pollutant: PollutantType, mode: RoadDisplayMode): string {
  let key: string = pollutant;
  let stops = TOTAL_STOPS[pollutant] || TOTAL_STOPS.aqi;
  if (mode === 'delta' && DELTA_STOPS[pollutant]) {
    key = `${pollutant}_delta`;
    stops = DELTA_STOPS[pollutant];
  }
  return lerpColor(stops, Number(props?.[key]) || 0);
}

// Opacity by confidence (matches prior OPACITY_EXPR: 0.4→0.5 .. 0.7→0.92)
function opacityFor(conf: number): number {
  const c = Number.isFinite(conf) ? conf : 0.5;
  if (c <= 0.4) return 0.5;
  if (c >= 0.7) return 0.92;
  return 0.5 + ((c - 0.4) / 0.3) * 0.42;
}

const MVT_META: RoadLayerMeta = {
  wind_speed: 0, waqi_station: null, satellite_no2: false,
  iqair_aqi: null, iqair_city: null, iqair_validation: null, count: 0,
};

// Load the self-hosted VectorGrid bundle once (IIFE extends the global L).
let vgPromise: Promise<void> | null = null;
export function ensureVectorGrid(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((L as any).vectorGrid) return Promise.resolve();
  if (!vgPromise) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).L = L;
    vgPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/leaflet-vectorgrid.js';
      s.async = true;
      s.onload = () => {
        // VectorGrid 1.3 calls L.DomEvent.fakeStop, removed in Leaflet 1.9: without it every tap on a road throws
        // and no popup opens. Restore the 1.7 behaviour (mark the event as handled).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const DE = (L as any).DomEvent;
        if (typeof DE.fakeStop !== 'function') DE.fakeStop = (e: { _stopped?: boolean }) => { e._stopped = true; return DE; };
        resolve();
      };
      s.onerror = () => reject(new Error('VectorGrid bundle failed to load'));
      document.head.appendChild(s);
    });
  }
  return vgPromise;
}

export function useRoadMvtLayer(
  map: L.Map | null,
  enabled: boolean,
  pollutant: PollutantType = 'aqi',
  displayMode: RoadDisplayMode = 'total',
): RoadLayerMeta | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  // Keep the current mode readable by the (long-lived) style closure without recreating the layer
  const modeRef = useRef<{ pollutant: PollutantType; displayMode: RoadDisplayMode }>({ pollutant, displayMode });
  modeRef.current = { pollutant, displayMode };
  // Contrast = viewport-RELATIVE: normalize each road's real dispersion delta to the
  // viewport p90, mapped green→red (so genuine per-road differences pop). p90 is gathered
  // from the deltas seen while styling, then applied on a redraw — 2-pass, self-converging.
  const contrastMaxRef = useRef(0);
  const deltaBufRef = useRef<number[]>([]);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Create / destroy the layer (mode changes are a redraw, not a recreate)
  useEffect(() => {
    if (!map || !enabled) {
      layerRef.current?.remove?.();
      layerRef.current = null;
      return;
    }
    let cancelled = false;
    // Recompute the contrast p90 from the deltas gathered during the last style pass,
    // then redraw to apply it (guarded so it converges instead of looping).
    const scheduleSettle = () => {
      if (settleRef.current) clearTimeout(settleRef.current);
      settleRef.current = setTimeout(() => {
        const arr = deltaBufRef.current;
        deltaBufRef.current = [];
        if (arr.length < 3) return;
        arr.sort((a, b) => a - b);
        const p90 = arr[Math.floor(arr.length * 0.9)] || 0.1;
        const prev = contrastMaxRef.current;
        if (prev === 0 || Math.abs(p90 - prev) / (prev || 1) > 0.08) {
          contrastMaxRef.current = p90;
          layerRef.current?.redraw?.();
        }
      }, 220);
    };
    ensureVectorGrid()
      .then(() => {
        if (cancelled || !map) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const LG = L as any;
        const layer = LG.vectorGrid.protobuf(`${window.location.origin}/api/tiles/road-mvt/{z}/{x}/{y}`, {
          rendererFactory: LG.canvas.tile,
          interactive: true,
          maxNativeZoom: 18, // render NATIVE vectors at every zoom (no z16 canvas upscaling = no blur)
          minZoom: 12,
          maxZoom: 18,
          pane: 'overlayPane',
          vectorTileLayerStyles: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            roads: (props: any, zoom: number) => {
              const { pollutant: p, displayMode: m } = modeRef.current;
              const ood = Number(props?.ood) === 1;
              let color: string;
              if (ood) {
                color = '#9ca3af'; // outside calibration support → neutral grey
              } else if (m === 'contrast' && (p === 'pm25' || p === 'no2' || p === 'pm10')) {
                const d = Number(props?.[`${p}_delta`]) || 0;
                if (d > 0) { deltaBufRef.current.push(d); scheduleSettle(); }
                const t = Math.max(0, Math.min(1, d / (contrastMaxRef.current || CONTRAST_FALLBACK[p] || 1)));
                color = lerpColor(TOTAL_STOPS.aqi, t * 300); // relative green→red
              } else {
                // total / delta (contrast on aqi/o3 has no delta → fall back to total)
                color = colorFor(props, p, m === 'contrast' ? 'total' : m);
              }
              return {
                color,
                weight: weightFor(props?.highway, zoom),
                opacity: ood ? 0.5 : opacityFor(Number(props?.confidence_score)),
                lineCap: 'round',
                lineJoin: 'round',
              };
            },
          },
        });
        layerRef.current = layer;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layer.on('click', (e: any) => {
          const pr = (e.layer && e.layer.properties) || {};
          const aqi = Number(pr.aqi ?? 0);
          const band = aqiBand(aqi);
          const html =
            `<div style="min-width:150px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">` +
            `<span style="width:9px;height:9px;border-radius:50%;background:${band.color};display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>` +
            `<span style="font-weight:700;font-size:13px;color:#111">AQI ${Math.round(aqi)}</span>` +
            `<span style="font-size:11px;color:#666">${band.label}</span></div>` +
            `<div style="font-size:11px;color:#444">PM2.5 <b>${Number(pr.pm25 ?? 0).toFixed(1)}</b> µg/m³</div></div>`;
          L.popup({ closeButton: true, className: 'glass-popup', offset: [0, -2], autoPan: true })
            .setLatLng(e.latlng).setContent(html).openOn(map);
          L.DomEvent.stop(e);
        });
        layer.addTo(map);
      })
      .catch((err) => console.warn('[RoadMvtLayer]', err));
    return () => {
      cancelled = true;
      if (settleRef.current) clearTimeout(settleRef.current);
      layerRef.current?.remove?.();
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled]);

  // Switch color mode — reset the contrast scale (so it recomputes for the new pollutant/mode)
  // and redraw, which re-runs the style closure (tiles are CDN/browser-cached, so cheap).
  useEffect(() => {
    contrastMaxRef.current = 0;
    deltaBufRef.current = [];
    const layer = layerRef.current;
    if (layer && typeof layer.redraw === 'function') layer.redraw();
  }, [pollutant, displayMode]);

  return enabled ? MVT_META : null;
}
