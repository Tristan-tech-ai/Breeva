import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css'; // GL canvas sizing/positioning inside Leaflet
import '@maplibre/maplibre-gl-leaflet';
import type { PollutantType, RoadDisplayMode } from '../../types';
import type { RoadLayerMeta } from './RoadPollutionLayer';

// Gold-standard road-color layer: PostGIS-generated Mapbox Vector Tiles
// (/api/tiles/road-mvt) rendered by MapLibre GL on the GPU inside the existing
// Leaflet map (via @maplibre/maplibre-gl-leaflet). Crisp at every zoom (vector
// overzoom), smooth, CDN-cached. One tile carries every property, so color modes
// switch client-side via a paint expression with NO refetch. Tap (long-press /
// right-click) hit-tests the rendered vectors for the exact road's values.

const TOTAL_STOPS: Record<string, [number, string][]> = {
  aqi:  [[0, '#00E400'], [50, '#FFFF00'], [100, '#FF7E00'], [150, '#FF0000'], [200, '#8F3F97'], [300, '#7E0023']],
  pm25: [[0, '#00E400'], [12, '#FFFF00'], [35.4, '#FF7E00'], [55.4, '#FF0000'], [150.4, '#8F3F97'], [250.4, '#7E0023']],
  no2:  [[0, '#00E400'], [40, '#FFFF00'], [100, '#FF7E00'], [200, '#FF0000'], [400, '#8F3F97'], [1000, '#7E0023']],
  o3:   [[0, '#00E400'], [60, '#FFFF00'], [100, '#FF7E00'], [140, '#FF0000'], [240, '#8F3F97'], [380, '#7E0023']],
  pm10: [[0, '#00E400'], [54, '#FFFF00'], [154, '#FF7E00'], [254, '#FF0000'], [354, '#8F3F97'], [424, '#7E0023']],
};
const DELTA_STOPS: Record<string, [number, string][]> = {
  pm25: [[0, '#00E400'], [0.5, '#FFFF00'], [2, '#FF7E00'], [5, '#FF0000'], [10, '#8F3F97'], [25, '#7E0023']],
  no2:  [[0, '#00E400'], [2, '#FFFF00'], [10, '#FF7E00'], [25, '#FF0000'], [60, '#8F3F97'], [150, '#7E0023']],
  pm10: [[0, '#00E400'], [1, '#FFFF00'], [4, '#FF7E00'], [10, '#FF0000'], [20, '#8F3F97'], [50, '#7E0023']],
};

// MapLibre line-color expression for (pollutant, mode). Grey for OOD-refused roads.
function colorExpr(pollutant: PollutantType, mode: RoadDisplayMode): unknown {
  let prop: string = pollutant;
  let stops = TOTAL_STOPS[pollutant] || TOTAL_STOPS.aqi;
  if (mode === 'delta' && DELTA_STOPS[pollutant]) {
    prop = `${pollutant}_delta`;
    stops = DELTA_STOPS[pollutant];
  }
  const interp: unknown[] = ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', prop]], 0]];
  for (const [v, c] of stops) { interp.push(v, c); }
  return ['case', ['==', ['get', 'ood'], 1], '#9ca3af', interp];
}

const WIDTH_EXPR: unknown = ['interpolate', ['exponential', 1.6], ['zoom'],
  12, ['match', ['get', 'highway'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], 1.6,
    ['primary', 'primary_link', 'secondary', 'secondary_link'], 1.1, 0.6],
  16, ['match', ['get', 'highway'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], 6,
    ['primary', 'primary_link', 'secondary', 'secondary_link'], 4, 2.2],
];
const OPACITY_EXPR: unknown = ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'confidence_score']], 0.5],
  0.4, 0.5, 0.7, 0.92];

const MVT_META: RoadLayerMeta = {
  wind_speed: 0, waqi_station: null, satellite_no2: false,
  iqair_aqi: null, iqair_city: null, iqair_validation: null, count: 0,
};

function aqiBand(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Baik', color: '#00E400' };
  if (aqi <= 100) return { label: 'Sedang', color: '#d9b500' };
  if (aqi <= 150) return { label: 'Tidak sehat (sensitif)', color: '#FF7E00' };
  if (aqi <= 200) return { label: 'Tidak sehat', color: '#FF0000' };
  if (aqi <= 300) return { label: 'Sangat tidak sehat', color: '#8F3F97' };
  return { label: 'Berbahaya', color: '#7E0023' };
}

function buildStyle(pollutant: PollutantType, mode: RoadDisplayMode) {
  return {
    version: 8 as const,
    sources: {
      roads: {
        type: 'vector' as const,
        tiles: [`${window.location.origin}/api/tiles/road-mvt/{z}/{x}/{y}`],
        minzoom: 12, maxzoom: 16,
      },
    },
    layers: [{
      id: 'road-colors',
      type: 'line' as const,
      source: 'roads',
      'source-layer': 'roads',
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
      paint: {
        'line-color': colorExpr(pollutant, mode),
        'line-width': WIDTH_EXPR,
        'line-opacity': OPACITY_EXPR,
      },
    }],
  };
}

export function useRoadMvtLayer(
  map: L.Map | null,
  enabled: boolean,
  pollutant: PollutantType = 'aqi',
  displayMode: RoadDisplayMode = 'total',
): RoadLayerMeta | null {
  const glRef = useRef<L.Layer | null>(null);
  const mlRef = useRef<MlMap | null>(null);

  // Create / destroy the GL layer (not on pollutant/mode change — that's a paint update)
  useEffect(() => {
    if (!map || !enabled) {
      glRef.current?.remove();
      glRef.current = null;
      mlRef.current = null;
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gl = (L as any).maplibreGL({ interactive: false, style: buildStyle(pollutant, displayMode) });
    gl.addTo(map);
    glRef.current = gl;
    mlRef.current = (gl.getMaplibreMap?.() ?? null) as MlMap | null;
    return () => {
      glRef.current?.remove();
      glRef.current = null;
      mlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled]);

  // Switch color mode client-side (no refetch) — the tile already has every property
  useEffect(() => {
    const m = mlRef.current;
    if (!m) return;
    const apply = () => {
      try {
        if (m.getLayer('road-colors')) {
          m.setPaintProperty('road-colors', 'line-color', colorExpr(pollutant, displayMode));
        }
      } catch { /* style not ready */ }
    };
    if (m.isStyleLoaded()) apply();
    else m.once('load', apply);
  }, [pollutant, displayMode]);

  // Tap → exact road values from the rendered vectors (no extra request)
  useEffect(() => {
    if (!map || !enabled) return;
    const onCtx = (e: L.LeafletMouseEvent) => {
      const m = mlRef.current;
      if (!m) return;
      try {
        const p = m.project([e.latlng.lng, e.latlng.lat]);
        const feats = m.queryRenderedFeatures(
          [[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]],
          { layers: ['road-colors'] },
        );
        if (!feats.length) return;
        const pr = feats[0].properties || {};
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
      } catch { /* non-fatal */ }
    };
    map.on('contextmenu', onCtx);
    return () => { map.off('contextmenu', onCtx); };
  }, [map, enabled]);

  return enabled ? MVT_META : null;
}
