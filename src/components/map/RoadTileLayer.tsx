import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { supabase } from '../../lib/supabase';
import type { RoadLayerMeta } from './RoadPollutionLayer';

// Raster road-color tiles (default Total/AQI view). The colors are pre-rendered
// server-side into 256px PNG tiles (api/vayu/_tilepng), so the client just shows a
// static Leaflet TileLayer — no GeoJSON transfer, no per-road vector render, zoom
// handled by the tile pyramid. Each tile is CDN-cached → <100ms after first render.
// Tap (long-press / right-click) is re-added via a nearest-road point query since a
// raster tile has no per-road geometry to hit-test.
const MIN_ZOOM = 12;

function aqiBand(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Baik', color: '#00E400' };
  if (aqi <= 100) return { label: 'Sedang', color: '#d9b500' };
  if (aqi <= 150) return { label: 'Tidak sehat (sensitif)', color: '#FF7E00' };
  if (aqi <= 200) return { label: 'Tidak sehat', color: '#FF0000' };
  if (aqi <= 300) return { label: 'Sangat tidak sehat', color: '#8F3F97' };
  return { label: 'Berbahaya', color: '#7E0023' };
}

const TILE_META: RoadLayerMeta = {
  wind_speed: 0, waqi_station: null, satellite_no2: false,
  iqair_aqi: null, iqair_city: null, iqair_validation: null, count: 0,
};

export function useRoadTileLayer(map: L.Map | null, enabled: boolean): RoadLayerMeta | null {
  const layerRef = useRef<L.TileLayer | null>(null);

  // Mount / unmount the tile layer
  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    if (!layerRef.current) {
      const layer = L.tileLayer('/api/tiles/road/{z}/{x}/{y}', {
        minZoom: MIN_ZOOM,
        maxNativeZoom: 16,   // render up to z16; higher zooms upscale (no tile flood)
        updateWhenZooming: false,
        keepBuffer: 2,
        zIndex: 250,         // above the base map, below markers
        crossOrigin: true,
      });
      layer.addTo(map);
      layerRef.current = layer;
    }
    return () => {
      layerRef.current?.remove();
      layerRef.current = null;
    };
  }, [map, enabled]);

  // Tap → nearest precomputed road AQI popup (contextmenu never conflicts with
  // the map click→setDestination flow). Mirrors the vector layer's road-tap.
  useEffect(() => {
    if (!map || !enabled) return;
    const onCtx = async (e: L.LeafletMouseEvent) => {
      try {
        const { data } = await supabase.rpc('nearest_precomputed_aqi', {
          p_lat: e.latlng.lat, p_lon: e.latlng.lng, p_max_m: 250,
        });
        const r = Array.isArray(data) ? data[0] : data;
        if (!r || r.aqi == null) return;
        const band = aqiBand(r.aqi);
        const html =
          `<div style="min-width:150px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">` +
          `<span style="width:9px;height:9px;border-radius:50%;background:${band.color};display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>` +
          `<span style="font-weight:700;font-size:13px;color:#111">AQI ${Math.round(r.aqi)}</span>` +
          `<span style="font-size:11px;color:#666">${band.label}</span></div>` +
          `<div style="font-size:11px;color:#444">PM2.5 <b>${Number(r.pm25 ?? 0).toFixed(1)}</b> µg/m³</div></div>`;
        L.popup({ closeButton: true, className: 'glass-popup', offset: [0, -2], autoPan: true })
          .setLatLng(e.latlng).setContent(html).openOn(map);
      } catch { /* non-fatal */ }
    };
    map.on('contextmenu', onCtx);
    return () => { map.off('contextmenu', onCtx); };
  }, [map, enabled]);

  return enabled ? TILE_META : null;
}
