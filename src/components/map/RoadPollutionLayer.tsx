import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import type { PollutantType, RoadAQIFeature, RoadAQIResponse } from '../../types';
import { SpatialTileCache } from '../../lib/spatial-tile-cache';

// Meta info exposed to UI
export interface RoadLayerMeta {
  wind_speed: number;
  waqi_station: string | null;
  satellite_no2: boolean;
  iqair_aqi: number | null;
  iqair_city: string | null;
  iqair_validation: 'cross-validated' | 'partially-validated' | 'divergent' | null;
  count: number;
}

// Singleton tile cache: 120 entries, 15-min TTL (larger cache = higher hit rate)
const roadCache = new SpatialTileCache<RoadAQIResponse>(120, 15);

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
const MIN_ZOOM = 10;

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

// ── Zoom-based road type filter (client-side LOD) ────────────
// At low zoom, only show major roads to prevent clutter
const ZOOM_ROAD_FILTER: Record<number, Set<string> | null> = {
  10: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link']),
  11: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']),
  12: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']),
  13: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street']),
};

// Max polylines to render (Canvas performance limit)
const MAX_RENDER_ROADS = 5000;

export function useRoadPollutionLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
  forecastHour = 0,
): RoadLayerMeta | null {
  // Single persistent layer group — clear+rebuild pattern (no orphaned layers)
  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const controllerRef = useRef<AbortController | null>(null);
  const dataRef = useRef<RoadAQIResponse | null>(null);
  const trailingRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [meta, setMeta] = useState<RoadLayerMeta | null>(null);
  // Track the fetched padded bounds to know if viewport still covered
  const fetchedBoundsRef = useRef<{ s: number; w: number; n: number; e: number; z: number } | null>(null);

  // ── Render data into the EXISTING layer group (clear + rebuild) ──
  const renderData = useCallback(
    (data: RoadAQIResponse, currentPollutant: PollutantType) => {
      if (!map) return;
      // Clear ALL existing polylines from the single group
      layerRef.current.clearLayers();

      const zoom = Math.round(map.getZoom());
      const filter = ZOOM_ROAD_FILTER[zoom] ?? null; // null = show all (z14+)

      let rendered = 0;
      for (const road of data.roads) {
        // Client-side LOD: skip roads that don't belong at this zoom
        if (filter && !filter.has(road.highway)) continue;
        // Cap total rendered polylines for Canvas performance
        if (rendered >= MAX_RENDER_ROADS) break;

        const coords = road.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple,
        );
        if (coords.length < 2) continue;
        const color = getConcentrationColor(getValue(road, currentPollutant), currentPollutant);
        const zoomScale = zoom >= 16 ? 1.6 : zoom >= 15 ? 1.3 : zoom >= 13 ? 1.0 : zoom >= 12 ? 0.7 : 0.5;
        const weight = Math.max(1, road.weight * zoomScale);
        L.polyline(coords, {
          color,
          weight,
          opacity: 0.85,
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
          renderer: getCanvasRenderer(),
        }).addTo(layerRef.current);
        rendered++;
      }

      setMeta({
        wind_speed: data.meta.wind_speed ?? 0,
        waqi_station: data.meta.waqi_station,
        satellite_no2: data.meta.satellite_no2 ?? false,
        iqair_aqi: data.meta.iqair_aqi ?? null,
        iqair_city: data.meta.iqair_city ?? null,
        iqair_validation: data.meta.iqair_validation ?? null,
        count: data.meta.count,
      });
    },
    [map],
  );

  // ── Check if current viewport is still covered by fetched data ──
  const viewportCovered = useCallback((): boolean => {
    if (!map || !fetchedBoundsRef.current) return false;
    const b = map.getBounds();
    const z = Math.round(map.getZoom());
    const fb = fetchedBoundsRef.current;
    // Exact zoom match required — different zoom = different road set (LOD)
    return fb.z === z
      && fb.s <= b.getSouth() && fb.w <= b.getWest()
      && fb.n >= b.getNorth() && fb.e >= b.getEast();
  }, [map]);

  // ── Render from cache only (instant, no network) ───────────
  // Returns true if fresh cache hit (no fetch needed)
  const renderCached = useCallback((): boolean => {
    if (!map || !visible) return false;
    const zoom = Math.round(map.getZoom());
    if (zoom < MIN_ZOOM) {
      layerRef.current.clearLayers();
      dataRef.current = null;
      fetchedBoundsRef.current = null;
      setMeta(null);
      return false;
    }
    if (viewportCovered() && dataRef.current) return true;

    // Adaptive padding: less at low zoom to stay within server maxSpan
    const padFactor = zoom >= 14 ? 0.5 : zoom >= 12 ? 0.3 : 0.15;
    const bounds = map.getBounds().pad(padFactor);
    const s = bounds.getSouth(), w = bounds.getWest();
    const n = bounds.getNorth(), e = bounds.getEast();

    // Only use fresh cache — NO stale/cross-zoom fallbacks (prevents ghost layers)
    const cached = roadCache.get(s, w, n, e, zoom);
    if (cached) {
      dataRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      renderData(cached, pollutant);
      return true;
    }

    // Safe fallback: only stale data at SAME zoom with containment check
    const stale = roadCache.getStale(s, w, n, e, zoom);
    if (stale) {
      dataRef.current = stale;
      renderData(stale, pollutant);
      // Don't update fetchedBoundsRef — still need fresh data
    }
    return false;
  }, [map, visible, pollutant, renderData, viewportCovered]);

  // ── Fetch data with viewport padding ───────────────────────
  const fetchData = useCallback(async () => {
    if (!map || !visible) return;
    const zoom = Math.round(map.getZoom());
    if (zoom < MIN_ZOOM) {
      layerRef.current.clearLayers();
      dataRef.current = null;
      fetchedBoundsRef.current = null;
      setMeta(null);
      return;
    }

    // If viewport is still covered by last fetch → skip (0 HTTP)
    if (viewportCovered() && dataRef.current) return;

    // Pad viewport — adaptive: less at low zoom to stay within server maxSpan
    const padFactor = zoom >= 14 ? 0.5 : zoom >= 12 ? 0.3 : 0.15;
    const bounds = map.getBounds().pad(padFactor);
    const s = bounds.getSouth(), w = bounds.getWest();
    const n = bounds.getNorth(), e = bounds.getEast();

    // 1. Fresh cache hit → render, skip HTTP
    const cached = roadCache.get(s, w, n, e, zoom);
    if (cached) {
      dataRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      renderData(cached, pollutant);
      return;
    }

    // 2. Safe stale fallback: same zoom + containment only (no cross-zoom ghost data)
    const stale = roadCache.getStale(s, w, n, e, zoom);
    if (stale) {
      dataRef.current = stale;
      renderData(stale, pollutant);
      // Don't update fetchedBoundsRef — still need fresh
    }

    // 3. Abort in-flight, start new fetch
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    try {
      const params = new URLSearchParams({
        south: s.toFixed(6), west: w.toFixed(6),
        north: n.toFixed(6), east: e.toFixed(6),
        zoom: String(zoom),
      });
      if (forecastHour > 0) params.set('forecast_hour', String(forecastHour));

      const resp = await fetch(`/api/vayu/road-aqi?${params}`, { signal: ac.signal });
      if (!resp.ok || ac.signal.aborted) return;
      const data: RoadAQIResponse = await resp.json();
      if (ac.signal.aborted) return;

      roadCache.set(s, w, n, e, zoom, data);
      dataRef.current = data;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      renderData(data, pollutant);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [map, visible, forecastHour, pollutant, renderData, viewportCovered]);

  // ── Prefetch 2 adjacent tiles during idle (limited to save serverless slots) ──
  const prefetchAdjacent = useCallback(() => {
    if (!map || !visible || !dataRef.current) return;
    const zoom = Math.round(map.getZoom());
    if (zoom < MIN_ZOOM || zoom < 12) return; // Only prefetch at z12+ (small payloads)

    const bounds = map.getBounds();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    // Only 2 directions (N/S or E/W based on aspect) to conserve serverless slots
    const offsets = latSpan > lngSpan
      ? [[0, lngSpan], [0, -lngSpan]]  // landscape: prefetch left/right
      : [[latSpan, 0], [-latSpan, 0]]; // portrait: prefetch up/down

    for (const [dLat, dLng] of offsets) {
      const ps = bounds.getSouth() + dLat;
      const pw = bounds.getWest() + dLng;
      const pn = bounds.getNorth() + dLat;
      const pe = bounds.getEast() + dLng;
      if (roadCache.get(ps, pw, pn, pe, zoom)) continue;
      const params = new URLSearchParams({
        south: ps.toFixed(6), west: pw.toFixed(6),
        north: pn.toFixed(6), east: pe.toFixed(6),
        zoom: String(zoom),
      });
      if (forecastHour > 0) params.set('forecast_hour', String(forecastHour));
      fetch(`/api/vayu/road-aqi?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) roadCache.set(ps, pw, pn, pe, zoom, data); })
        .catch(() => {});
    }
  }, [map, visible, forecastHour]);

  // Attach layer group once
  useEffect(() => {
    if (!map) return;
    layerRef.current.addTo(map);
    return () => { layerRef.current.remove(); };
  }, [map]);

  // Pollutant change → re-render from existing data (ZERO HTTP)
  useEffect(() => {
    if (!visible || !dataRef.current) return;
    renderData(dataRef.current, pollutant);
  }, [pollutant, visible, renderData]);

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

  // ── Map move → cache-first instant render + debounced network fetch ──
  // During continuous pan: only cached renders (0ms), no network storm.
  // After user stops (400ms): ONE network fetch fires.
  useEffect(() => {
    if (!map || !visible) return;
    const onMove = () => {
      // Instantly render from cache (0ms)
      const fresh = renderCached();
      if (fresh) return; // fresh cache hit, no network needed

      // Debounce network fetch: fires once after 400ms of no movement
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(() => fetchData(), 400);
    };
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
      if (trailingRef.current) clearTimeout(trailingRef.current);
    };
  }, [map, visible, renderCached, fetchData]);

  // Prefetch adjacent tiles after data loaded (idle callback)
  useEffect(() => {
    if (!dataRef.current || !map || !visible) return;
    if (typeof requestIdleCallback === 'undefined') return;
    const id = requestIdleCallback(() => prefetchAdjacent());
    return () => cancelIdleCallback(id);
  }, [prefetchAdjacent, map, visible]);

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
