import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { ensureVectorGrid } from './RoadMvtLayer';
import { weightFor } from '../../lib/roadColors';
import { fieldColor } from '../../lib/field/color';
import { FIELD_REGIONS, FieldSource, overzoomPoints } from '../../lib/field/source';
import { HARGA_COLORS } from '../../lib/field/harga';
import { popupHtml } from '../../lib/field/popup';
import { nearestFeature, tileFraction, unitsPerPixel, type TileFeature } from '../../lib/field/tap';

// Road colors from the static field (VITE_FIELD_STATIC): geometry from a PMTiles archive, values from BVF1 cells.
// No call to /api/vayu/road-aqi or the database. Tiles exist for z10-14; z15-18 reuse the z14 tile, rescaled.

const MAX_NATIVE = 14;
/** How far from a road a tap still selects it, in screen pixels. */
const TAP_PX = 10;
const TILE_CACHE = 96;
const FIELD_META: RoadLayerMeta = {
  wind_speed: 0, waqi_station: null, satellite_no2: false, iqair_aqi: null, iqair_city: null, iqair_validation: null, count: 0,
};

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
    // Decoded native tiles (z <= 14) per region, for tapping (see lib/field/tap.ts).
    const tapSources: Array<{ src: FieldSource; bounds: L.LatLngBounds; tiles: Map<string, TileFeature[]> }> = [];
    const tapAt = (latlng: L.LatLng): boolean => {
      const zoom = map.getZoom();
      const z = Math.min(MAX_NATIVE, Math.round(zoom));
      for (const t of tapSources) {
        if (!t.bounds.contains(latlng)) continue;
        const f = tileFraction(latlng.lat, latlng.lng, z);
        const tx = Math.floor(f.x), ty = Math.floor(f.y);
        const feats = t.tiles.get(`${z}/${tx}/${ty}`);
        if (!feats?.length) continue;
        const extent = feats[0].extent ?? 4096;
        const hit = nearestFeature(feats, (f.x - tx) * extent, (f.y - ty) * extent, TAP_PX * unitsPerPixel(extent, z, zoom));
        if (!hit) continue;
        const pr = hit.feature.properties;
        const c = Number(pr.c), i = Number(pr.i);
        L.popup({ closeButton: true, className: 'glass-popup', offset: [0, -2], autoPan: true })
          .setLatLng(latlng).setContent(popupHtml(t.src.value(c, i), pr.n as string | undefined, t.src, c, i)).openOn(map);
        return true;
      }
      return false;
    };
    (map as unknown as { __fieldTap?: { tapAt: (ll: L.LatLng) => boolean } }).__fieldTap = { tapAt };
    ensureVectorGrid()
      .then(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const LG = L as any;
        const Proto = LG.VectorGrid.Protobuf;
        for (const region of FIELD_REGIONS) {
          const src = new FieldSource(region);
          try { await src.init(); } catch (e) { console.warn('[field]', region.name, e); continue; }
          if (cancelled) return;
          const tiles = new Map<string, TileFeature[]>();
          tapSources.push({ src, bounds: L.latLngBounds(region.bounds), tiles });
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
              const key = `${coords.z - dz}/${coords.x >> dz}/${coords.y >> dz}`;
              if (!tiles.has(key)) {
                // keep the native geometry (before any overzoom rescale) for tapping
                tiles.set(key, (json.layers.roads?.features ?? []).map((f: TileFeature) => ({ geometry: f.geometry, properties: f.properties, extent: f.extent })));
                if (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value as string);
              }
              if (dz > 0) {
                for (const name in json.layers) {
                  for (const f of json.layers[name].features) f.geometry = overzoomPoints(f.geometry, f.extent, coords, MAX_NATIVE);
                }
              }
              return json;
            },
          });
          const layer = new FieldGrid('', {
            rendererFactory: LG.canvas.tile, interactive: false, minZoom: 10, maxZoom: 18, maxNativeZoom: 18,
            bounds: L.latLngBounds(region.bounds), pane: 'overlayPane',
            vectorTileLayerStyles: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              roads: (props: any, zoom: number) => {
                const v = src.value(Number(props.c), Number(props.i));
                const highway = src.highway(Number(props.h));
                if (!v) return { color: '#cbd5e1', weight: weightFor(highway, zoom), opacity: 0.35 };
                const { pollutant: p, displayMode: m } = modeRef.current;
                let color: string;
                if (m === 'harga') {
                  const h = src.harga?.value(Number(props.c), Number(props.i));
                  color = h == null || !src.harga ? '#cbd5e1' : HARGA_COLORS[src.harga.klass(h)];
                } else {
                  color = fieldColor(v, p, m);
                }
                return {
                  color, weight: weightFor(highway, zoom),
                  opacity: v.ood ? 0.5 : src.isStale() ? 0.55 : 0.9, lineCap: 'round', lineJoin: 'round',
                };
              },
            },
          });
          let redrawTimer: ReturnType<typeof setTimeout> | undefined;
          src.onCell = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => layer.redraw(), 120); };
          layer.addTo(map);
          created.push(layer);
          layersRef.current = [...layersRef.current, layer];
        }
      })
      .catch((err) => console.warn('[FieldLayer]', err));
    return () => {
      cancelled = true;
      delete (map as unknown as { __fieldTap?: unknown }).__fieldTap;
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
