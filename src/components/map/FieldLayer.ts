import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { UBIN_HEMAT } from '../../lib/mapPerf';
import { weightFor, opacityFor } from '../../lib/roadColors';
import { fieldColor } from '../../lib/field/color';
import { FIELD_DRAWN_EVENT, FIELD_REGIONS, FieldSource, type Box } from '../../lib/field/source';
import { decodeTileLines, type MvtTileLine } from '../../lib/nasional/mvt';
import { gambarUbin, type GayaRuas } from '../../lib/field/gambarRuas';
import { FIELD_FAILED_EVENT, FIRST_DRAW_FALLBACK_MS, regionGate, routeSettled, markFieldDrawn } from '../../lib/field/firstDraw';
import { HARGA_COLORS } from '../../lib/field/harga';
import { bukaKartu, kartuRuas, kartuTerbuka, KARTU_TUTUP } from '../../lib/field/kartu';
import { nearestFeature, tileFraction, unitsPerPixel, type TileFeature } from '../../lib/field/tap';

// Road colors from the static field (VITE_FIELD_STATIC): geometry from a PMTiles archive, values from BVF1 cells.
// No call to /api/vayu/road-aqi or the database. Tiles exist for z10-14; z15-18 reuse the z14 tile, rescaled.
// N-41: drawn by our own canvas grid layer (lib/field/gambarRuas.ts) instead of Leaflet.VectorGrid.

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
  /** a route link is open: every region, the one in view too (F1-63), waits for its first route (F1-53) */
  waitRoute = false,
): RoadLayerMeta | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersRef = useRef<any[]>([]);
  const sourcesRef = useRef<FieldSource[]>([]);
  const modeRef = useRef({ pollutant, displayMode });
  modeRef.current = { pollutant, displayMode };

  useEffect(() => {
    if (!map || !enabled) return;
    let cancelled = false;
    const created: unknown[] = [];
    // Decoded native tiles (z <= 14) per region, for tapping (see lib/field/tap.ts).
    const tapSources: Array<{ src: FieldSource; bounds: L.LatLngBounds; tiles: Map<string, TileFeature[]> }> = [];
    // M-U01: a tapped road opens the card at the bottom edge (KartuRuas), not a Leaflet popup; the map does not move.
    let lastTap: { src: FieldSource; c: number; i: number; name: string | undefined } | null = null;
    let tanda: L.CircleMarker | null = null;
    const tandai = (ll: L.LatLng) => {
      tanda?.remove();
      tanda = L.circleMarker(ll, { radius: 7, color: '#0f172a', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(map);
    };
    const lepasTanda = () => { tanda?.remove(); tanda = null; lastTap = null; };
    window.addEventListener(KARTU_TUTUP, lepasTanda);
    const kirimKartu = (baru: boolean) => {
      if (!lastTap) return;
      const { src, c, i, name } = lastTap;
      const v = src.value(c, i);
      const m = src.manifest;
      const { pollutant: p, displayMode: mode } = modeRef.current;
      bukaKartu({
        id: `${src.region.name}:${c}:${i}`,
        kartu: kartuRuas(v, name, src, c, i, p, mode),
        // N-04: the road's exhaust now and at the run's forecast hours, loaded only when the card opens
        seri: baru && v && m?.forecast_runs?.length
          ? () => import('../../lib/field/roadSeries').then(({ roadSeries, sparkSvg }) =>
            roadSeries(src.base, src.region.name, m, c, i, v.no2_delta).then((pts) => ({ pts, svg: sparkSvg(pts, 260, 52) })))
          : undefined,
      });
    };
    (map as unknown as { __kartuUlang?: () => void }).__kartuUlang = () => { if (kartuTerbuka()) kirimKartu(false); };
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
        lastTap = { src: t.src, c, i, name: pr.n as string | undefined };
        tandai(latlng);
        kirimKartu(true);
        return true;
      }
      return false;
    };
    (map as unknown as { __fieldTap?: { tapAt: (ll: L.LatLng) => boolean } }).__fieldTap = { tapAt };
    // F1-13: the region in view first, with its visible cells fetched beside the geometry; the other regions and the
    // harga hirup files only after the first colored roads are drawn or the region failed (F1-51: not after a fixed 6 s,
    // which on slow 3G let them take the bandwidth before the first roads), so they do not compete for bandwidth.
    const b = map.getBounds();
    const view: Box = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    const centre = map.getCenter();
    const ordered = [...FIELD_REGIONS].sort((p, q) => Number(L.latLngBounds(q.bounds).contains(centre)) - Number(L.latLngBounds(p.bounds).contains(centre)));
    let drawn = false;
    let markDrawn: () => void = () => {};
    const firstDrawn = new Promise<void>((resolve) => { markDrawn = resolve; setTimeout(resolve, FIRST_DRAW_FALLBACK_MS); });
    // the first region cannot be drawn: release the base map and the other regions at once
    const failFirst = () => { if (drawn) return; drawn = true; markDrawn(); markFieldDrawn(window); window.dispatchEvent(new Event(FIELD_FAILED_EVENT)); };
    // what the region in view does not need yet (other regions, harga files) waits for this
    const othersGo = waitRoute ? Promise.all([firstDrawn, routeSettled()]).then(() => undefined) : firstDrawn;
    Promise.resolve()
      .then(async () => {
        for (const [k, region] of ordered.entries()) {
          await regionGate(k, waitRoute, othersGo); // F1-63: on a route link even the region in view waits for the route
          if (cancelled) return;
          const src = new FieldSource(region);
          try { await src.init(k === 0 ? view : undefined); } catch (e) { console.warn('[field]', region.name, e); if (k === 0) failFirst(); continue; }
          if (cancelled) return;
          sourcesRef.current = [...sourcesRef.current, src];
          void othersGo.then(() => (modeRef.current.displayMode === 'harga' ? undefined : new Promise((r) => setTimeout(r, 2000)))).then(() => src.ensureHarga());
          if (modeRef.current.displayMode === 'harga') void src.ensureHarga();
          const tiles = new Map<string, TileFeature[]>();
          tapSources.push({ src, bounds: L.latLngBounds(region.bounds), tiles });
          // N-41: native tiles decoded once (also feeding the tap lookup); child tiles of a zoom drawn from this cache
          const decoded = new Map<string, Promise<{ extent: number; features: MvtTileLine[] } | null>>();
          const native = (z: number, x: number, y: number) => {
            const key = `${z}/${x}/${y}`;
            let p = decoded.get(key);
            if (!p) {
              p = src.tile(z, x, y).then((r) => {
                if (!r) return null;
                const t = decodeTileLines(new Uint8Array(r.data), 'roads');
                if (!tiles.has(key)) {
                  tiles.set(key, t.features.map((f) => ({ geometry: f.rings, properties: f.props, extent: t.extent })));
                  if (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value as string);
                }
                return t;
              }).catch((e) => { console.warn('[field] tile', key, e); decoded.delete(key); return null; });
              decoded.set(key, p);
              if (decoded.size > TILE_CACHE) decoded.delete(decoded.keys().next().value as string);
            }
            return p;
          };
          const gaya = (zoom: number) => (props: MvtTileLine['props']): GayaRuas | null => {
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
            return { color, weight: weightFor(highway, zoom), opacity: opacityFor(highway, zoom, v.ood ? 0.5 : src.isStale() ? 0.55 : 0.9) };
          };
          const LapisanRuas = L.GridLayer.extend({
            createTile(this: L.GridLayer, coords: L.Coords, done: L.DoneCallback) {
              const size = this.getTileSize();
              const dpr = Math.min(2, window.devicePixelRatio || 1);
              const canvas = document.createElement('canvas');
              canvas.width = size.x * dpr; canvas.height = size.y * dpr;
              const n = 2 ** coords.z;
              // Leaflet can ask for tiles outside the world range (wrapping); pmtiles throws on those.
              if (coords.x < 0 || coords.y < 0 || coords.x >= n || coords.y >= n) { setTimeout(() => done(undefined, canvas), 0); return canvas; }
              const dz = Math.max(0, coords.z - MAX_NATIVE);
              void native(coords.z - dz, coords.x >> dz, coords.y >> dz).then((t) => {
                const ctx = canvas.getContext('2d');
                if (t && ctx) gambarUbin(ctx, t, coords, gaya(coords.z), { maxNative: MAX_NATIVE, tileSize: size.x, dpr });
                done(undefined, canvas);
              });
              return canvas;
            },
          }) as unknown as new (o: L.GridLayerOptions) => L.GridLayer;
          const layer: L.GridLayer = new LapisanRuas({
            minZoom: 10, maxZoom: 18, maxNativeZoom: 18, bounds: L.latLngBounds(region.bounds), pane: 'overlayPane', ...UBIN_HEMAT,
          });
          let redrawTimer: ReturnType<typeof setTimeout> | undefined;
          src.onCell = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => layer.redraw(), 120); };
          // "drawn" = the visible tiles have loaded while values exist, so colored roads are on screen; only then may
          // the base map, the other regions and the harga file use the connection (a cell alone arrived too early)
          layer.on('load', () => {
            if (drawn) return;
            // tiles are in but no value yet: wait for the cell requests; if none arrived, the region failed
            if (!src.hasCells()) { if (k === 0) void src.cellsSettled().then(() => { if (!src.hasCells()) failFirst(); }); return; }
            drawn = true;
            setTimeout(() => { markDrawn(); markFieldDrawn(window); window.dispatchEvent(new Event(FIELD_DRAWN_EVENT)); }, 50);
          });
          layer.addTo(map);
          created.push(layer);
          layersRef.current = [...layersRef.current, layer];
        }
      })
      .catch((err) => console.warn('[FieldLayer]', err));
    return () => {
      cancelled = true;
      delete (map as unknown as { __fieldTap?: unknown }).__fieldTap;
      delete (map as unknown as { __kartuUlang?: unknown }).__kartuUlang;
      window.removeEventListener(KARTU_TUTUP, lepasTanda);
      tanda?.remove();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const l of created as any[]) l.remove?.();
      layersRef.current = [];
      sourcesRef.current = [];
    };
  // waitRoute is read once: the layer is not rebuilt when the route link is later cleared
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled]);

  useEffect(() => {
    if (displayMode === 'harga') for (const s of sourcesRef.current) void s.ensureHarga();
    for (const l of layersRef.current) l.redraw?.();
    (map as unknown as { __kartuUlang?: () => void } | null)?.__kartuUlang?.(); // the open card follows the mode
  }, [pollutant, displayMode, map]);

  return enabled ? FIELD_META : null;
}
