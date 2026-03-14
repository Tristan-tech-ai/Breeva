import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadAQIFeature, RoadAQIResponse } from '../../types';
import { SpatialTileCache } from '../../lib/spatial-tile-cache';

// Meta info exposed to UI
export interface RoadLayerMeta {
  wind_speed: number;
  waqi_station: string | null;
  satellite_no2: boolean;
  count: number;
}

// Singleton tile cache (persists across re-renders)
const roadCache = new SpatialTileCache<RoadAQIResponse>(50, 5);

// ── Color scales per pollutant ───────────────────────────────

function getConcentrationColor(value: number, pollutant: PollutantType): string {
  // Continuous gradient: dark blue → cyan → green → yellow → orange → red
  const stops = getColorStops(pollutant);
  // Find bracketing stops
  for (let i = 0; i < stops.length - 1; i++) {
    if (value <= stops[i + 1].v) {
      const t = (value - stops[i].v) / (stops[i + 1].v - stops[i].v);
      return lerpColor(stops[i].c, stops[i + 1].c, Math.max(0, Math.min(1, t)));
    }
  }
  return stops[stops.length - 1].c;
}

function getColorStops(pollutant: PollutantType): { v: number; c: string }[] {
  switch (pollutant) {
    case 'pm25':
      return [
        { v: 0, c: '#1e3a5f' },     // dark blue
        { v: 5, c: '#0ea5e9' },     // cyan
        { v: 12, c: '#22c55e' },    // green
        { v: 25, c: '#eab308' },    // yellow
        { v: 35, c: '#f97316' },    // orange
        { v: 55, c: '#ef4444' },    // red
        { v: 150, c: '#7f1d1d' },   // dark red
      ];
    case 'no2':
      return [
        { v: 0, c: '#1e3a5f' },
        { v: 10, c: '#0ea5e9' },
        { v: 20, c: '#22c55e' },
        { v: 40, c: '#eab308' },
        { v: 80, c: '#f97316' },
        { v: 150, c: '#ef4444' },
        { v: 300, c: '#7f1d1d' },
      ];
    case 'o3':
      return [
        { v: 0, c: '#1e3a5f' },
        { v: 30, c: '#0ea5e9' },
        { v: 60, c: '#22c55e' },
        { v: 90, c: '#eab308' },
        { v: 120, c: '#f97316' },
        { v: 180, c: '#ef4444' },
        { v: 240, c: '#7f1d1d' },
      ];
    case 'pm10':
      return [
        { v: 0, c: '#1e3a5f' },
        { v: 15, c: '#0ea5e9' },
        { v: 30, c: '#22c55e' },
        { v: 50, c: '#eab308' },
        { v: 80, c: '#f97316' },
        { v: 120, c: '#ef4444' },
        { v: 250, c: '#7f1d1d' },
      ];
    default: // AQI
      return [
        { v: 0, c: '#1e3a5f' },
        { v: 25, c: '#0ea5e9' },
        { v: 50, c: '#22c55e' },
        { v: 100, c: '#eab308' },
        { v: 150, c: '#f97316' },
        { v: 200, c: '#ef4444' },
        { v: 300, c: '#a855f7' },
        { v: 500, c: '#7f1d1d' },
      ];
  }
}

// Linear interpolation between two hex colors
function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function getValue(road: RoadAQIFeature, pollutant: PollutantType): number {
  switch (pollutant) {
    case 'pm25': return road.pm25;
    case 'no2': return road.no2;
    case 'o3': return road.o3;
    case 'pm10': return road.pm10;
    default: return road.aqi;
  }
}

// ── Minimum zoom for road overlay ────────────────────────────
// Phase 3: lowered from 13 → 11 to show motorways/trunk at wider zoom
const MIN_ZOOM = 11;

// ── Shared Canvas renderer for WebGL-like performance ────────
// Canvas renderer handles 2000+ polylines at 60fps vs SVG's ~500 limit
let sharedCanvasRenderer: L.Canvas | null = null;
function getCanvasRenderer(): L.Canvas {
  if (!sharedCanvasRenderer) {
    sharedCanvasRenderer = L.canvas({ padding: 0.5, tolerance: 5 });
  }
  return sharedCanvasRenderer;
}

// ── Hook: Road Pollution Layer ───────────────────────────────

export function useRoadPollutionLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
  forecastHour = 0,
): RoadLayerMeta | null {
  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const dataRef = useRef<RoadAQIResponse | null>(null);
  const [meta, setMeta] = useState<RoadLayerMeta | null>(null);

  // ── Render polylines from cached data (pure UI, no HTTP) ───
  const renderFromData = useCallback(
    (data: RoadAQIResponse, currentPollutant: PollutantType) => {
      if (!map) return;
      layerRef.current.clearLayers();
      const zoom = map.getZoom();
      for (const road of data.roads) {
        const coords = road.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple,
        );
        if (coords.length < 2) continue;
        const color = getConcentrationColor(getValue(road, currentPollutant), currentPollutant);
        const zoomScale = zoom >= 16 ? 1.6 : zoom >= 15 ? 1.3 : zoom >= 13 ? 1.0 : zoom >= 12 ? 0.7 : 0.5;
        L.polyline(coords, {
          color,
          weight: road.weight * zoomScale,
          opacity: 0.85,
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
          renderer: getCanvasRenderer(),
        }).addTo(layerRef.current);
      }
      setMeta({
        wind_speed: data.meta.wind_speed,
        waqi_station: data.meta.waqi_station,
        satellite_no2: data.meta.satellite_no2 ?? false,
        count: data.meta.count,
      });
    },
    [map],
  );

  // ── Fetch data (only when bbox/zoom/forecastHour changes) ──
  const fetchData = useCallback(async () => {
    if (!map || !visible) return;
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      layerRef.current.clearLayers();
      dataRef.current = null;
      setMeta(null);
      return;
    }

    const bounds = map.getBounds();
    const s = bounds.getSouth(), w = bounds.getWest();
    const n = bounds.getNorth(), e = bounds.getEast();

    // 1. Fresh cache hit → render instantly, skip HTTP
    const cached = roadCache.get(s, w, n, e, zoom);
    if (cached) {
      dataRef.current = cached;
      renderFromData(cached, pollutant);
      return;
    }

    // 2. Stale data → show immediately (stale-while-revalidate)
    const stale = roadCache.getStale(s, w, n, e, zoom);
    if (stale) {
      dataRef.current = stale;
      renderFromData(stale, pollutant);
    }

    // 3. Abort any in-flight request, start new one
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    try {
      const params = new URLSearchParams({
        south: s.toFixed(6), west: w.toFixed(6),
        north: n.toFixed(6), east: e.toFixed(6),
        zoom: String(Math.round(zoom)),
      });
      if (forecastHour > 0) params.set('forecast_hour', String(forecastHour));

      const resp = await fetch(`/api/vayu/road-aqi?${params}`, { signal: ac.signal });
      if (!resp.ok || ac.signal.aborted) return;
      const data: RoadAQIResponse = await resp.json();
      if (ac.signal.aborted) return;

      roadCache.set(s, w, n, e, zoom, data);
      dataRef.current = data;
      renderFromData(data, pollutant);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [map, visible, forecastHour, pollutant, renderFromData]);

  // Attach layer group once
  useEffect(() => {
    if (!map) return;
    layerRef.current.addTo(map);
    return () => { layerRef.current.remove(); };
  }, [map]);

  // Pollutant change → re-render from existing data (ZERO HTTP)
  useEffect(() => {
    if (!visible || !dataRef.current) return;
    renderFromData(dataRef.current, pollutant);
  }, [pollutant, visible, renderFromData]);

  // Visibility / forecastHour toggle → may need fetch
  useEffect(() => {
    if (!visible) {
      layerRef.current.clearLayers();
      controllerRef.current?.abort();
      return;
    }
    fetchData();
    return () => { controllerRef.current?.abort(); };
  }, [visible, forecastHour, fetchData]);

  // Map move → debounced fetch (300ms)
  useEffect(() => {
    if (!map || !visible) return;
    const onMove = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchData, 300);
    };
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map, visible, fetchData]);

  return meta;
}

// ── Pollutant selector labels ────────────────────────────────

export const POLLUTANT_OPTIONS: { id: PollutantType; label: string; unit: string; description: string }[] = [
  { id: 'aqi', label: 'AQI', unit: '', description: 'Air Quality Index (US EPA)' },
  { id: 'pm25', label: 'PM₂.₅', unit: 'μg/m³', description: 'Fine particulate matter' },
  { id: 'no2', label: 'NO₂', unit: 'μg/m³', description: 'Nitrogen dioxide' },
  { id: 'o3', label: 'O₃', unit: 'μg/m³', description: 'Ozone (inverted near traffic)' },
  { id: 'pm10', label: 'PM₁₀', unit: 'μg/m³', description: 'Coarse particulate matter' },
];

// Export color stops for legend rendering
export { getColorStops };
