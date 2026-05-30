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
  // L-3 fix: true while a fetch is in-flight. Used by LeafletMap to render a
  // top-bar "Loading roads..." skeleton during the 500-1500ms wait window so
  // users get immediate feedback after toggling the layer on.
  isFetching?: boolean;
}

// Singleton tile cache: 120 entries, 15-min TTL (larger cache = higher hit rate)
const roadCache = new SpatialTileCache<RoadAQIResponse>(120, 15);

// ── Color scales per pollutant ───────────────────────────────

// (Color dispatch lives in getRoadColor below — continuous ramp.
// The step-based categorizer was replaced by rampRgb for smoother resolution.)

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

// ── Continuous color ramp ────────────────────────────────────
// Interpolates between the SAME fixed band anchors used by the step scale — so
// real small differences (e.g. 30 vs 35 µg/m³) show as a gradient instead of
// collapsing into one 6-step bin. NOT viewport-relative — scales stay fixed to
// real values ("no make-up"); identical input → identical color anywhere.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rampRgb(value: number, stops: { v: number; c: string }[]): { r: number; g: number; b: number } {
  if (value <= stops[0].v) return hexToRgb(stops[0].c);
  for (let i = 0; i < stops.length - 1; i++) {
    if (value < stops[i + 1].v) {
      const span = stops[i + 1].v - stops[i].v || 1;
      const t = (value - stops[i].v) / span;
      const a = hexToRgb(stops[i].c), b = hexToRgb(stops[i + 1].c);
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
      };
    }
  }
  return hexToRgb(stops[stops.length - 1].c);
}
// ── Road color dispatcher ────────────────────────────────────
// 'total'    = absolute health level (continuous WHO ramp).
// 'delta'    = road-only contribution above baseline (continuous, tight µg/m³ ramp).
// 'contrast' = ENHANCED view: the REAL per-road dispersion delta normalized to the area's
//              p90 → green (lowest real contribution) → red (highest). Same factual physics
//              data, but a RELATIVE per-view scale so genuine per-road differences pop. Clearly
//              labeled as relative — it does NOT claim an absolute health level. contrastMax = p90.
// total/delta scales are fixed to real values (no auto-stretch). OOD-refused → neutral grey.
function getRoadColor(road: RoadAQIFeature, pollutant: PollutantType, mode: RoadDisplayMode, contrastMax = 0): string {
  if (road.ood_refused || road.confidence === 'refuse') return 'rgb(156,163,175)'; // grey: outside calibration support
  if (mode === 'delta') {
    const { r, g, b } = rampRgb(getValue(road, pollutant, 'delta'), getDeltaColorStops(pollutant));
    return `rgb(${r},${g},${b})`;
  }
  if (mode === 'contrast' && (pollutant === 'pm25' || pollutant === 'no2' || pollutant === 'pm10')) {
    // Real dispersion delta normalized to the viewport p90, mapped green→red — highlights the
    // roads genuinely contributing the most traffic pollution in THIS area (relative scale).
    const t = Math.max(0, Math.min(1, getValue(road, pollutant, 'delta') / (contrastMax || 1)));
    const { r, g, b } = rampRgb(t * 300, getColorStops('aqi')); // green(0) → … → red/purple(300)
    return `rgb(${r},${g},${b})`;
  }
  // 'total' (and aqi/o3 fallback): continuous absolute ramp
  const { r, g, b } = rampRgb(getValue(road, pollutant, 'total'), getColorStops(pollutant));
  return `rgb(${r},${g},${b})`;
}

// ── Road-tap inspect (long-press / right-click) ──────────────
// Roads render on a NON-interactive canvas (perf: 2000+ polylines), so individual
// polylines can't fire click. Instead we hit-test the tapped pixel against the
// road geometry held in dataRef. Bound to `contextmenu` (long-press on mobile /
// right-click on desktop) so it NEVER conflicts with the map `click → setDestination`
// core flow. Surfaces the v2 per-road calibrated uncertainty (PM2.5 + 95% PI +
// confidence) — the honest "estimasi vs presisi" story, per road.
function pointSegDistPx(p: L.Point, a: L.Point, b: L.Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return p.distanceTo(a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return p.distanceTo(L.point(a.x + t * dx, a.y + t * dy));
}
function nearestRoadAt(map: L.Map, roads: RoadAQIFeature[], latlng: L.LatLng): RoadAQIFeature | null {
  const p = map.latLngToContainerPoint(latlng);
  let best: RoadAQIFeature | null = null;
  let bestD = 16; // px hit radius
  for (const road of roads) {
    const c = road.geometry.coordinates;
    if (c.length < 2) continue;
    // Cheap lat/lng prebox: skip roads with no vertex within ~1km of the tap before
    // doing pixel-precise distance (avoids converting every vertex of every road).
    let near = false;
    for (let i = 0; i < c.length; i++) {
      if (Math.abs(c[i][1] - latlng.lat) < 0.01 && Math.abs(c[i][0] - latlng.lng) < 0.01) { near = true; break; }
    }
    if (!near) continue;
    let prev = map.latLngToContainerPoint([c[0][1], c[0][0]]);
    for (let i = 1; i < c.length; i++) {
      const cur = map.latLngToContainerPoint([c[i][1], c[i][0]]);
      const d = pointSegDistPx(p, prev, cur);
      if (d < bestD) { bestD = d; best = road; }
      prev = cur;
    }
  }
  return best;
}
function aqiBand(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Baik', color: '#00E400' };
  if (aqi <= 100) return { label: 'Sedang', color: '#d9b500' };
  if (aqi <= 150) return { label: 'Tidak sehat (sensitif)', color: '#FF7E00' };
  if (aqi <= 200) return { label: 'Tidak sehat', color: '#FF0000' };
  if (aqi <= 300) return { label: 'Sangat tidak sehat', color: '#8F3F97' };
  return { label: 'Berbahaya', color: '#7E0023' };
}
const HIGHWAY_LABEL: Record<string, string> = {
  motorway: 'Jalan tol', trunk: 'Jalan arteri', primary: 'Jalan utama',
  secondary: 'Jalan sekunder', tertiary: 'Jalan tersier', residential: 'Jalan perumahan',
  service: 'Jalan layanan', living_street: 'Jalan lingkungan', unclassified: 'Jalan',
};
function roadPopupHtml(road: RoadAQIFeature): string {
  const band = aqiBand(road.aqi);
  const hw = HIGHWAY_LABEL[road.highway] ?? road.highway ?? 'Jalan';
  const refused = road.ood_refused || road.confidence === 'refuse';
  const confLabel = road.confidence === 'high' ? 'tinggi'
    : road.confidence === 'medium' ? 'sedang'
    : road.confidence === 'low' ? 'rendah' : null;
  const rows: string[] = [];
  rows.push(
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">` +
    `<span style="width:9px;height:9px;border-radius:50%;background:${band.color};display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>` +
    `<span style="font-weight:700;font-size:13px;color:#111">AQI ${Math.round(road.aqi)}</span>` +
    `<span style="font-size:11px;color:#666">${band.label}</span></div>`,
  );
  const deltaTxt = road.pm25_delta ? ` · kontribusi jalan +${road.pm25_delta.toFixed(1)}` : '';
  rows.push(`<div style="font-size:11px;color:#444">PM2.5 <b>${road.pm25.toFixed(1)}</b> µg/m³${deltaTxt}</div>`);
  if (road.engine === 'v2' && !refused && typeof road.pi95_lo === 'number' && typeof road.pi95_hi === 'number') {
    rows.push(
      `<div style="font-size:11px;color:#666;margin-top:2px">rentang 95% ` +
      `${road.pi95_lo.toFixed(0)}–${road.pi95_hi.toFixed(0)} µg/m³` +
      `${confLabel ? ` · keyakinan ${confLabel}` : ''}</div>`,
    );
  } else if (refused) {
    rows.push(`<div style="font-size:11px;color:#999;margin-top:2px">Di luar jangkauan kalibrasi — estimasi tidak pasti</div>`);
  }
  return `<div style="min-width:150px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#888;margin-bottom:3px">${hw}</div>${rows.join('')}</div>`;
}

// ── Minimum zoom for road overlay. C-2 fix: lowered from 14→12 so
// city-overview zooms still render colored arterials. Server-side already
// filters to motorway/trunk/primary at z<14 (small payload at low zoom).
const MIN_ZOOM = 12;

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

      // 'contrast' mode: normalize the REAL per-road delta to the viewport's p90 so the
      // genuine (but small-in-absolute) per-road differences become perceptible. Computed
      // once per render from the visible roads' deltas; 0 for other modes (unused there).
      let contrastMax = 0;
      if (currentMode === 'contrast') {
        const deltas = data.roads
          .map((r) => getValue(r, currentPollutant, 'delta'))
          .filter((v) => Number.isFinite(v) && v > 0)
          .sort((a, b) => a - b);
        contrastMax = deltas.length ? deltas[Math.floor(deltas.length * 0.9)] : 0;
        if (!(contrastMax > 0)) contrastMax = 0.1; // floor avoids div-by-0 in flat areas
      }

      for (const road of data.roads) {
        const coords = road.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple,
        );
        if (coords.length < 2) continue;

        // 'total' = absolute level vs EPA/WHO; 'delta' = road-only contribution; 'contrast' =
        // relative per-view heatmap of the real delta (enhanced visibility, clearly labeled).
        const color = getRoadColor(road, currentPollutant, currentMode, contrastMax);

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

    // L-3: signal "loading" immediately via meta so the parent can render a
    // skeleton/spinner. We preserve existing meta fields (count, station, etc.)
    // so legend doesn't blink to zero between fetches.
    setMeta((prev) => ({
      wind_speed: prev?.wind_speed ?? 0,
      waqi_station: prev?.waqi_station ?? null,
      satellite_no2: prev?.satellite_no2 ?? false,
      iqair_aqi: prev?.iqair_aqi ?? null,
      iqair_city: prev?.iqair_city ?? null,
      iqair_validation: prev?.iqair_validation ?? null,
      count: prev?.count ?? 0,
      gcn_applied_count: prev?.gcn_applied_count,
      isFetching: true,
    }));

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
        setMeta((prev) => prev ? { ...prev, isFetching: false } : null);
        return;
      }
      const data: RoadAQIResponse = await resp.json();
      if (ac.signal.aborted) return;

      roadCache.set(s, w, n, e, zoom, data);
      dataRef.current = data;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      atomicSwap(data, pollutant, displayMode);
      // atomicSwap calls setMeta with fresh data; ensure isFetching is cleared
      setMeta((prev) => prev ? { ...prev, isFetching: false } : null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setMeta((prev) => prev ? { ...prev, isFetching: false } : null);
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

  // Road-tap inspect: long-press (mobile) / right-click (desktop) → popup with the
  // tapped road's v2 PM2.5 + 95% PI + confidence. Hit-tests dataRef geometry (canvas
  // roads are non-interactive). `contextmenu` never fires alongside `click`, so the
  // map's click→setDestination flow is untouched.
  useEffect(() => {
    if (!map) return;
    const onCtx = (e: L.LeafletMouseEvent) => {
      if (!visible) return;
      const data = dataRef.current;
      if (!data || !data.roads.length) return;
      const road = nearestRoadAt(map, data.roads, e.latlng);
      if (!road) return;
      L.popup({ closeButton: true, className: 'glass-popup', offset: [0, -2], autoPan: true })
        .setLatLng(e.latlng)
        .setContent(roadPopupHtml(road))
        .openOn(map);
    };
    map.on('contextmenu', onCtx);
    return () => { map.off('contextmenu', onCtx); };
  }, [map, visible]);

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
