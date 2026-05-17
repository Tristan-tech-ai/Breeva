import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import type {
  PollutantType,
  RoadAQIFeature,
  RoadAQIResponse,
  RoadDisplayMode,
} from '../../types';
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
  // Tier 3.5: number of roads in current viewport with GraphSAGE delta applied
  gcn_applied_count?: number;
}

// Singleton tile cache: 120 entries, 15-min TTL (larger cache = higher hit rate)
const roadCache = new SpatialTileCache<RoadAQIResponse>(120, 15);

// ── Color scales per pollutant ───────────────────────────────

function getConcentrationColor(
  value: number,
  pollutant: PollutantType,
  mode: RoadDisplayMode = 'total',
): string {
  // Step-based categorization at standard breakpoints (EPA for AQI, WHO/EU for
  // pollutants). Color represents the category the value falls into — NOT a
  // smooth gradient — so AQI 49 and AQI 51 cross a real category boundary.
  //
  // In 'delta' mode, breakpoints are much tighter (µg/m³ scale of road-only
  // contribution, not absolute), so road-level resolution becomes visible.
  const stops = mode === 'delta' ? getDeltaColorStops(pollutant) : getColorStops(pollutant);
  for (let i = 0; i < stops.length - 1; i++) {
    if (value < stops[i + 1].v) {
      return stops[i].c;
    }
  }
  return stops[stops.length - 1].c;
}

// Delta-mode breakpoints (road contribution above baseline, µg/m³). Tighter
// than absolute breakpoints because baseline (30-50 µg/m³ Jakarta PM2.5) has
// been removed — most delta values cluster in 0-10 µg/m³ range.
function getDeltaColorStops(pollutant: PollutantType): { v: number; c: string }[] {
  switch (pollutant) {
    case 'pm25':
      return [
        { v: 0,    c: '#00E400' },  // 0–0.5    Negligible (gang)
        { v: 0.5,  c: '#FFFF00' },  // 0.5–2    Low (residential)
        { v: 2,    c: '#FF7E00' },  // 2–5      Medium (collector)
        { v: 5,    c: '#FF0000' },  // 5–10     High (primary)
        { v: 10,   c: '#8F3F97' },  // 10–25    Very High (trunk/motorway)
        { v: 25,   c: '#7E0023' },  // 25+      Extreme (jam at motorway)
      ];
    case 'no2':
      return [
        { v: 0,   c: '#00E400' },
        { v: 2,   c: '#FFFF00' },
        { v: 10,  c: '#FF7E00' },
        { v: 25,  c: '#FF0000' },
        { v: 60,  c: '#8F3F97' },
        { v: 150, c: '#7E0023' },
      ];
    case 'pm10':
      return [
        { v: 0,   c: '#00E400' },
        { v: 1,   c: '#FFFF00' },
        { v: 4,   c: '#FF7E00' },
        { v: 10,  c: '#FF0000' },
        { v: 20,  c: '#8F3F97' },
        { v: 50,  c: '#7E0023' },
      ];
    case 'o3':
    default:
      // O3 has no meaningful "delta" (titration only reduces O3 near roads).
      // For AQI: fall back to absolute breakpoints scaled. Keep simple.
      return getColorStops(pollutant);
  }
}

function getColorStops(pollutant: PollutantType): { v: number; c: string }[] {
  // Stops define the LOWER bound of each category. A value v is colored stops[i].c
  // when stops[i].v <= v < stops[i+1].v.
  switch (pollutant) {
    case 'pm25':
      // WHO/EPA PM2.5 24h breakpoints (µg/m³).
      return [
        { v: 0,    c: '#00E400' },  // 0–12     Good
        { v: 12,   c: '#FFFF00' },  // 12–35.4  Moderate
        { v: 35.4, c: '#FF7E00' },  // 35.4–55.4 USG
        { v: 55.4, c: '#FF0000' },  // 55.4–150.4 Unhealthy
        { v: 150.4,c: '#8F3F97' },  // 150.4–250.4 Very Unhealthy
        { v: 250.4,c: '#7E0023' },  // 250.4+ Hazardous
      ];
    case 'no2':
      // WHO/EU NO2 hourly guidance (µg/m³).
      return [
        { v: 0,   c: '#00E400' },
        { v: 40,  c: '#FFFF00' },
        { v: 100, c: '#FF7E00' },
        { v: 200, c: '#FF0000' },
        { v: 400, c: '#8F3F97' },
        { v: 1000,c: '#7E0023' },
      ];
    case 'o3':
      // WHO O3 8h guidance (µg/m³).
      return [
        { v: 0,   c: '#00E400' },
        { v: 60,  c: '#FFFF00' },
        { v: 100, c: '#FF7E00' },
        { v: 140, c: '#FF0000' },
        { v: 240, c: '#8F3F97' },
        { v: 380, c: '#7E0023' },
      ];
    case 'pm10':
      // WHO/EPA PM10 24h breakpoints (µg/m³).
      return [
        { v: 0,   c: '#00E400' },
        { v: 54,  c: '#FFFF00' },
        { v: 154, c: '#FF7E00' },
        { v: 254, c: '#FF0000' },
        { v: 354, c: '#8F3F97' },
        { v: 424, c: '#7E0023' },
      ];
    default: // AQI — US EPA breakpoints
      return [
        { v: 0,   c: '#00E400' },  // 0–50     Good
        { v: 50,  c: '#FFFF00' },  // 51–100   Moderate
        { v: 100, c: '#FF7E00' },  // 101–150  USG
        { v: 150, c: '#FF0000' },  // 151–200  Unhealthy
        { v: 200, c: '#8F3F97' },  // 201–300  Very Unhealthy
        { v: 300, c: '#7E0023' },  // 301+     Hazardous
      ];
  }
}

function getValue(
  road: RoadAQIFeature,
  pollutant: PollutantType,
  mode: RoadDisplayMode = 'total',
): number {
  if (mode === 'delta') {
    // O3 has no delta (only titration). AQI delta would require derived calc.
    // ?? 0 protects against legacy cached responses (pre-D1 API) where
    // pm25_delta/no2_delta/pm10_delta fields don't exist yet.
    switch (pollutant) {
      case 'pm25': return road.pm25_delta ?? 0;
      case 'no2': return road.no2_delta ?? 0;
      case 'pm10': return road.pm10_delta ?? 0;
      case 'o3': return road.o3;       // no delta concept
      default: return road.aqi;
    }
  }
  switch (pollutant) {
    case 'pm25': return road.pm25;
    case 'no2': return road.no2;
    case 'o3': return road.o3;
    case 'pm10': return road.pm10;
    default: return road.aqi;
  }
}

// ── Minimum zoom for road overlay (14+ = demo-safe, looks great at street level) ──
const MIN_ZOOM = 14;

// ── Shared Canvas renderer for WebGL-like performance ────────
// Canvas renderer handles 2000+ polylines at 60fps vs SVG's ~500 limit
let sharedCanvasRenderer: L.Canvas | null = null;
function getCanvasRenderer(): L.Canvas {
  if (!sharedCanvasRenderer) {
    // padding: 0 — only render roads inside the visible viewport.
    // No off-screen pre-render. Matches base map tile behavior exactly.
    sharedCanvasRenderer = L.canvas({ padding: 0, tolerance: 5 });
  }
  return sharedCanvasRenderer;
}

// ── Hook: Road Pollution Layer ───────────────────────────────

export function useRoadPollutionLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
  forecastHour = 0,
  displayMode: RoadDisplayMode = 'total',
): RoadLayerMeta | null {
  // Two layer groups for atomic swap: old stays visible until new is ready
  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const controllerRef = useRef<AbortController | null>(null);
  const dataRef = useRef<RoadAQIResponse | null>(null);
  const trailingRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [meta, setMeta] = useState<RoadLayerMeta | null>(null);
  // Track the fetched padded bounds to know if viewport still covered
  const fetchedBoundsRef = useRef<{ s: number; w: number; n: number; e: number; z: number } | null>(null);

  // ── Build polylines into a NEW layer group (off-screen) ────
  const buildLayer = useCallback(
    (
      data: RoadAQIResponse,
      currentPollutant: PollutantType,
      currentMode: RoadDisplayMode,
    ): L.LayerGroup => {
      const group = L.layerGroup();
      const zoom = map?.getZoom() ?? 14;

      for (const road of data.roads) {
        const coords = road.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple,
        );
        if (coords.length < 2) continue;

        // 'total' mode: colors represent ABSOLUTE pollutant levels vs EPA/WHO
        // breakpoints. A clean city stays green even at street level.
        // 'delta' mode: colors represent ROAD-ONLY contribution above baseline,
        // surfacing per-segment variance (gang vs arterial vs motorway).
        const color = getConcentrationColor(
          getValue(road, currentPollutant, currentMode),
          currentPollutant,
          currentMode,
        );

        const zoomScale = zoom >= 16 ? 1.6 : zoom >= 15 ? 1.3 : zoom >= 13 ? 1.0 : zoom >= 12 ? 0.7 : 0.5;
        const weight = road.weight * zoomScale;
        // Phase 1.1: opacity + dashed stroke vary with confidence_score.
        // Tier 3.5: roads with gcn_applied get a +0.05 opacity boost (visual
        // "this is smarter" signal) capped at 0.95.
        const conf = typeof road.confidence_score === 'number' ? road.confidence_score : 0.5;
        let opacity = conf > 0.7 ? 0.9 : conf > 0.4 ? 0.6 : 0.4;
        if (road.gcn_applied) opacity = Math.min(0.95, opacity + 0.05);
        const dashArray = conf < 0.4 ? '6 4' : undefined;
        L.polyline(coords, {
          color,
          weight,
          opacity,
          dashArray,
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
          renderer: getCanvasRenderer(),
        }).addTo(group);
      }
      return group;
    },
    [map],
  );

  // ── ATOMIC SWAP: old layer stays until new is added ────────
  const atomicSwap = useCallback(
    (data: RoadAQIResponse, currentPollutant: PollutantType, currentMode: RoadDisplayMode) => {
      if (!map) return;
      const newGroup = buildLayer(data, currentPollutant, currentMode);
      // Add new FIRST, then remove old — never blank
      newGroup.addTo(map);
      layerRef.current.remove();
      layerRef.current = newGroup;
      const gcnAppliedCount = data.roads.reduce(
        (acc, r) => acc + (r.gcn_applied ? 1 : 0),
        0,
      );
      setMeta({
        wind_speed: data.meta.wind_speed ?? 0,
        waqi_station: data.meta.waqi_station,
        satellite_no2: data.meta.satellite_no2 ?? false,
        iqair_aqi: data.meta.iqair_aqi ?? null,
        iqair_city: data.meta.iqair_city ?? null,
        iqair_validation: data.meta.iqair_validation ?? null,
        count: data.meta.count,
        gcn_applied_count: gcnAppliedCount,
      });
    },
    [map, buildLayer],
  );

  // ── Check if current viewport is still covered by fetched data ──
  const viewportCovered = useCallback((): boolean => {
    if (!map || !fetchedBoundsRef.current) return false;
    const b = map.getBounds();
    const z = Math.round(map.getZoom());
    const fb = fetchedBoundsRef.current;
    // Strict zoom match — zoom changes are handled by clearing + re-fetch
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

    // 15% padding: cache can absorb small pans without re-fetch.
    // Canvas renderer still clips at padding:0 so no off-screen rendering.
    const bounds = map.getBounds();
    const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const lngPad = (bounds.getEast() - bounds.getWest()) * 0.15;
    const s = bounds.getSouth() - latPad, w = bounds.getWest() - lngPad;
    const n = bounds.getNorth() + latPad, e = bounds.getEast() + lngPad;

    const cached = roadCache.get(s, w, n, e, zoom);
    if (cached) {
      dataRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      atomicSwap(cached, pollutant, displayMode);
      return true;
    }

    // No fallback chain — blank is better than wrong-zoom ghost roads
    return false;
  }, [map, visible, pollutant, displayMode, atomicSwap, viewportCovered]);

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

    // 15% padding: fetched area slightly larger than viewport so cache
    // absorbs small pans. Canvas renderer clips at padding:0.
    const bounds = map.getBounds();
    const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const lngPad = (bounds.getEast() - bounds.getWest()) * 0.15;
    const s = bounds.getSouth() - latPad, w = bounds.getWest() - lngPad;
    const n = bounds.getNorth() + latPad, e = bounds.getEast() + lngPad;

    // 1. Fresh cache hit → atomic swap, skip HTTP
    const cached = roadCache.get(s, w, n, e, zoom);
    if (cached) {
      dataRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      atomicSwap(cached, pollutant, displayMode);
      return;
    }

    // No fallback chain — prevents ghost roads from wrong zoom levels.
    // Existing layer stays visible until fresh data arrives (atomic swap).

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
      if (ac.signal.aborted) return;
      if (!resp.ok) {
        // Failed fetch: clear stale roads so user doesn't see wrong-area data
        layerRef.current.clearLayers();
        dataRef.current = null;
        fetchedBoundsRef.current = null;
        return;
      }
      const data: RoadAQIResponse = await resp.json();
      if (ac.signal.aborted) return;

      roadCache.set(s, w, n, e, zoom, data);
      dataRef.current = data;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      atomicSwap(data, pollutant, displayMode);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [map, visible, forecastHour, pollutant, displayMode, atomicSwap, viewportCovered]);

  // ── Prefetch disabled for demo stability ──────────────────
  const prefetchAdjacent = useCallback(() => {
    return; // disabled — eliminates background 400 noise
  }, []);

  // Attach layer group once
  useEffect(() => {
    if (!map) return;
    layerRef.current.addTo(map);
    return () => { layerRef.current.remove(); };
  }, [map]);

  // Pollutant or displayMode change → re-render from existing data (ZERO HTTP)
  useEffect(() => {
    if (!visible || !dataRef.current) return;
    atomicSwap(dataRef.current, pollutant, displayMode);
  }, [pollutant, displayMode, visible, atomicSwap]);

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

  // ── Separate zoom and pan handlers for clean transitions ──
  // Zoom change: clear everything + immediate fresh fetch (prevents ghost roads)
  // Pan only:    cache-first instant render + debounced network fetch
  useEffect(() => {
    if (!map || !visible) return;
    let lastZoom = Math.round(map.getZoom());

    const onZoomEnd = () => {
      const newZoom = Math.round(map.getZoom());
      if (newZoom === lastZoom) return;
      // ZOOM CHANGED: clear everything, fetch fresh for new LOD
      lastZoom = newZoom;
      layerRef.current.clearLayers();
      dataRef.current = null;
      fetchedBoundsRef.current = null;
      if (trailingRef.current) clearTimeout(trailingRef.current);
      fetchData(); // immediate, no debounce
    };

    const onMoveEnd = () => {
      const currentZoom = Math.round(map.getZoom());
      if (currentZoom !== lastZoom) return; // handled by onZoomEnd

      // Pan only: try cache first
      const fresh = renderCached();
      if (fresh) return;

      // Debounce network fetch: fires once after 300ms of no movement
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(() => fetchData(), 300);
    };

    map.on('zoomend', onZoomEnd);
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('zoomend', onZoomEnd);
      map.off('moveend', onMoveEnd);
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
