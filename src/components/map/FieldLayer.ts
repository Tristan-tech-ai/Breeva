import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { ensureVectorGrid } from './RoadMvtLayer';
import { weightFor } from '../../lib/roadColors';
import { ispuRounded, pm25Category } from '../../lib/ispu';
import { fieldColor } from '../../lib/field/color';
import { ageLabel, FIELD_REGIONS, FieldSource, overzoomPoints } from '../../lib/field/source';
import type { CellValue } from '../../lib/field/cells';

// Road colors from the static field (VITE_FIELD_STATIC): geometry from a PMTiles archive, values from BVF1 cells.
// No call to /api/vayu/road-aqi or the database. Tiles exist for z10-14; z15-18 reuse the z14 tile, rescaled.

const MAX_NATIVE = 14;
const FIELD_META: RoadLayerMeta = {
  wind_speed: 0, waqi_station: null, satellite_no2: false, iqair_aqi: null, iqair_city: null, iqair_validation: null, count: 0,
};

function popupHtml(v: CellValue | undefined, name: string | undefined, src: FieldSource): string {
  const age = ageLabel(src.ageHours());
  const stale = src.isStale() ? ' · <b style="color:#b45309">data lama</b>' : '';
  if (!v) return `<div style="font-size:12px">Nilai ruas ini sedang dimuat.</div>`;
  const band = pm25Category(v.pm25);
  const index = ispuRounded('pm25', v.pm25) ?? 0;
  const lo = Math.max(0, v.pm25 - v.pi_half), hi = v.pm25 + v.pi_half;
  const title = name ? `<div style="font-weight:600;font-size:12px;color:#111;margin-bottom:3px">${name.replace(/</g, '&lt;')}</div>` : '';
  return `<div style="min-width:180px">${title}` +
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">` +
    `<span style="width:9px;height:9px;border-radius:50%;background:${band.color};display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>` +
    `<span style="font-weight:700;font-size:13px;color:#111">PM2.5 ${v.pm25.toFixed(1)} µg/m³</span></div>` +
    `<div style="font-size:11px;color:#444">ISPU ${index} · ${band.name} · rentang 95%: ${lo.toFixed(0)}–${hi.toFixed(0)} µg/m³</div>` +
    `<div style="font-size:11px;color:#444">dari lalu lintas ruas sekitar: PM2.5 +${v.pm25_delta.toFixed(2)} · NO₂ +${v.no2_delta.toFixed(1)} µg/m³ (NO₂ total ${v.no2.toFixed(0)})</div>` +
    (v.ood ? `<div style="font-size:11px;color:#6b7280">di luar wilayah terkalibrasi</div>` : '') +
    (src.manifest?.indicative ? `<div style="font-size:11px;color:#b45309">Indikatif: belum ada stasiun ukur di wilayah ini</div>` : '') +
    `<div style="font-size:10px;color:#6b7280;margin-top:3px">dihitung ${age}${stale}</div></div>`;
}

export function useFieldLayer(
  map: L.Map | null,
  enabled: boolean,
  pollutant: PollutantType = 'aqi',
  displayMode: RoadDisplayMode = 'total',
): RoadLayerMeta | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersRef = useRef<any[]>([]);
  const modeRef = useRef({ pollutant, displayMode });
  modeRef.current = { pollutant, displayMode };

  useEffect(() => {
    if (!map || !enabled) return;
    let cancelled = false;
    const created: unknown[] = [];
    ensureVectorGrid()
      .then(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const LG = L as any;
        const Proto = LG.VectorGrid.Protobuf;
        for (const region of FIELD_REGIONS) {
          const src = new FieldSource(region);
          try { await src.init(); } catch (e) { console.warn('[field]', region.name, e); continue; }
          if (cancelled) return;
          const FieldGrid = Proto.extend({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            _getVectorTilePromise: async function (this: any, coords: { x: number; y: number; z: number }) {
              const dz = Math.max(0, coords.z - MAX_NATIVE);
              const n = 2 ** coords.z;
              // Leaflet can ask for tiles outside the world range (wrapping); pmtiles throws on those.
              if (coords.x < 0 || coords.y < 0 || coords.x >= n || coords.y >= n) return { layers: {} };
              let r;
              try { r = await src.pm.getZxy(coords.z - dz, coords.x >> dz, coords.y >> dz); }
              catch (e) { console.warn('[field] tile', coords, e); return { layers: {} }; }
              if (!r) return { layers: {} };
              // Reuse the stock parser: point the URL template at a blob of this tile's bytes (template is read synchronously).
              const url = URL.createObjectURL(new Blob([r.data]));
              const saved = this._url;
              this._url = url;
              let json;
              try { json = await Proto.prototype._getVectorTilePromise.call(this, coords); }
              finally { this._url = saved; URL.revokeObjectURL(url); }
              if (dz > 0) {
                for (const name in json.layers) {
                  for (const f of json.layers[name].features) f.geometry = overzoomPoints(f.geometry, f.extent, coords, MAX_NATIVE);
                }
              }
              return json;
            },
          });
          const layer = new FieldGrid('', {
            rendererFactory: LG.canvas.tile, interactive: true, minZoom: 10, maxZoom: 18, maxNativeZoom: 18,
            bounds: L.latLngBounds(region.bounds), pane: 'overlayPane',
            vectorTileLayerStyles: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              roads: (props: any, zoom: number) => {
                const v = src.value(Number(props.c), Number(props.i));
                const highway = src.highway(Number(props.h));
                if (!v) return { color: '#cbd5e1', weight: weightFor(highway, zoom), opacity: 0.35 };
                const { pollutant: p, displayMode: m } = modeRef.current;
                return {
                  color: fieldColor(v, p, m), weight: weightFor(highway, zoom),
                  opacity: v.ood ? 0.5 : src.isStale() ? 0.55 : 0.9, lineCap: 'round', lineJoin: 'round',
                };
              },
            },
          });
          let redrawTimer: ReturnType<typeof setTimeout> | undefined;
          src.onCell = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => layer.redraw(), 120); };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          layer.on('click', (e: any) => {
            const pr = (e.layer && e.layer.properties) || {};
            const v = src.value(Number(pr.c), Number(pr.i));
            L.popup({ closeButton: true, className: 'glass-popup', offset: [0, -2], autoPan: true })
              .setLatLng(e.latlng).setContent(popupHtml(v, pr.n, src)).openOn(map);
            L.DomEvent.stop(e);
          });
          layer.addTo(map);
          created.push(layer);
          layersRef.current = [...layersRef.current, layer];
        }
      })
      .catch((err) => console.warn('[FieldLayer]', err));
    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const l of created as any[]) l.remove?.();
      layersRef.current = [];
    };
  }, [map, enabled]);

  useEffect(() => {
    for (const l of layersRef.current) l.redraw?.();
  }, [pollutant, displayMode]);

  return enabled ? FIELD_META : null;
}
