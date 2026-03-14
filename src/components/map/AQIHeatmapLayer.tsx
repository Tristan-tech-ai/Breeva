import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import type { PollutantType } from '../../types';
import { getColorStops } from './RoadPollutionLayer';

/**
 * Canvas-based AQI heatmap overlay for low zoom levels (z < 11).
 *
 * KEY FIX — Color consistency:
 * Grid points are snapped to a fixed global degree-grid (like map tiles).
 * e.g. at step=10°, points are always at ...-20,-10,0,10,20...
 * Same real-world location → always same Open-Meteo coordinates queried
 * → same API response → same color regardless of pan/zoom.
 */

interface GridAQIResponse {
  grid: number[];
  rows: number;
  cols: number;
  bounds: { south: number; west: number; north: number; east: number };
  pollutant: string;
}

// ── Fixed global degree-grid step per zoom tier ───────────────
// Coarser at low zoom (global scale), finer at high zoom (city scale)
function getStep(zoom: number): number {
  if (zoom <= 2) return 30;
  if (zoom <= 4) return 20;
  if (zoom <= 6) return 10;
  if (zoom <= 8) return 5;
  return 2; // z9-10
}

// Snap viewport bbox to global fixed-step degree grid.
// Identical region → identical bbox → identical server request → identical colors.
function snapBbox(b: L.LatLngBounds, zoom: number): { s: number; w: number; n: number; e: number; step: number } {
  const step = getStep(zoom);
  return {
    s: Math.max(-85, Math.floor(b.getSouth() / step) * step),
    w: Math.max(-180, Math.floor(b.getWest()  / step) * step),
    n: Math.min(85,   Math.ceil(b.getNorth()  / step) * step),
    e: Math.min(180,  Math.ceil(b.getEast()   / step) * step),
    step,
  };
}

// ── Simple TTL cache keyed by snapped bbox + step + pollutant ─
// Plain Map (not SpatialTileCache) because lookup is exact-key, not spatial.
interface HeatCacheEntry { data: GridAQIResponse; fetchedAt: number; }
const heatmapCache = new Map<string, HeatCacheEntry>();
const HEATMAP_TTL = 30 * 60_000; // 30 min

function heatKey(s: number, w: number, n: number, e: number, step: number, poll: string): string {
  return `${step}:${s}:${w}:${n}:${e}:${poll}`;
}
function heatGet(s: number, w: number, n: number, e: number, step: number, poll: string): GridAQIResponse | null {
  const entry = heatmapCache.get(heatKey(s, w, n, e, step, poll));
  if (!entry || Date.now() - entry.fetchedAt > HEATMAP_TTL) return null;
  return entry.data;
}
function heatGetStale(s: number, w: number, n: number, e: number, step: number, poll: string): GridAQIResponse | null {
  return heatmapCache.get(heatKey(s, w, n, e, step, poll))?.data ?? null;
}
function heatSet(s: number, w: number, n: number, e: number, step: number, poll: string, data: GridAQIResponse): void {
  if (heatmapCache.size > 60) {
    const oldest = heatmapCache.keys().next().value;
    if (oldest) heatmapCache.delete(oldest);
  }
  heatmapCache.set(heatKey(s, w, n, e, step, poll), { data, fetchedAt: Date.now() });
}

// ── Color interpolation using same scales as road layer ──────

function lerpColor(a: string, b: string, t: number): [number, number, number] {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

function valueToRGB(value: number, pollutant: PollutantType): [number, number, number] {
  const stops = getColorStops(pollutant);
  for (let i = 0; i < stops.length - 1; i++) {
    if (value <= stops[i + 1].v) {
      const t = (value - stops[i].v) / (stops[i + 1].v - stops[i].v);
      return lerpColor(stops[i].c, stops[i + 1].c, Math.max(0, Math.min(1, t)));
    }
  }
  const last = stops[stops.length - 1].c.replace('#', '');
  return [parseInt(last.slice(0, 2), 16), parseInt(last.slice(2, 4), 16), parseInt(last.slice(4, 6), 16)];
}

// ── Bilinear interpolation on grid ───────────────────────────

function sampleGrid(grid: number[], rows: number, cols: number, fy: number, fx: number): number {
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
  const y1 = Math.min(rows - 1, y0 + 1);
  const x1 = Math.min(cols - 1, x0 + 1);
  const ty = fy - y0;
  const tx = fx - x0;

  const v00 = grid[y0 * cols + x0];
  const v10 = grid[y0 * cols + x1];
  const v01 = grid[y1 * cols + x0];
  const v11 = grid[y1 * cols + x1];

  const top = v00 * (1 - tx) + v10 * tx;
  const bot = v01 * (1 - tx) + v11 * tx;
  return top * (1 - ty) + bot * ty;
}

// ── Render grid to persistent canvas ─────────────────────────

function renderHeatmapCanvas(
  data: GridAQIResponse,
  pollutant: PollutantType,
  canvas: HTMLCanvasElement,
): string {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imgData = ctx.createImageData(width, height);
  const { grid, rows, cols } = data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Map pixel to grid coordinates (row 0 = south, row N-1 = north)
      const fy = (1 - py / (height - 1)) * (rows - 1); // flip: canvas top = north
      const fx = (px / (width - 1)) * (cols - 1);
      const value = sampleGrid(grid, rows, cols, fy, fx);
      const [r, g, b] = valueToRGB(value, pollutant);
      const idx = (py * width + px) * 4;
      imgData.data[idx] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = 140; // ~55% opacity
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

// ── Fetch grid data ──────────────────────────────────────────

// Pass `step` instead of `res` so server uses same anchored grid points.
async function fetchGridAQI(
  south: number, west: number, north: number, east: number,
  step: number, pollutant: string,
  signal?: AbortSignal,
): Promise<GridAQIResponse | null> {
  try {
    const params = new URLSearchParams({
      south: String(south), west: String(west),
      north: String(north), east: String(east),
      step: String(step), pollutant,
    });
    const resp = await fetch(`/api/vayu/grid-aqi?${params}`, { signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────

const MAX_ZOOM = 11;
const CANVAS_SIZE = 384;

export function useAQIHeatmapLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
): void {
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastPollutantRef = useRef(pollutant);
  const lastGridRef = useRef<GridAQIResponse | null>(null);
  const lastThrottleRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Track snapped bounds + step tier to know when viewport leaves covered area
  const fetchedBoundsRef = useRef<{ s: number; w: number; n: number; e: number; step: number } | null>(null);
  // Persistent canvas — never recreated
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCanvas = useCallback((): HTMLCanvasElement => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = CANVAS_SIZE;
      canvasRef.current.height = CANVAS_SIZE;
    }
    return canvasRef.current;
  }, []);

  // ── Render data to overlay (reuses canvas + existing overlay) ──
  const renderOverlay = useCallback(
    (data: GridAQIResponse, currentPollutant: PollutantType) => {
      if (!map) return;
      const dataUrl = renderHeatmapCanvas(data, currentPollutant, getCanvas());
      if (!dataUrl) return;
      const imageBounds = L.latLngBounds(
        [data.bounds.south, data.bounds.west],
        [data.bounds.north, data.bounds.east],
      );
      if (overlayRef.current) {
        // Atomic update: reuse existing overlay (no flicker)
        overlayRef.current.setUrl(dataUrl);
        overlayRef.current.setBounds(imageBounds);
      } else {
        overlayRef.current = L.imageOverlay(dataUrl, imageBounds, {
          opacity: 1,
          interactive: false,
          zIndex: 200,
        }).addTo(map);
      }
    },
    [map, getCanvas],
  );

  const cleanup = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
  }, []);

  // Check if current viewport is covered by last fetched data
  const viewportCovered = useCallback((): boolean => {
    if (!map || !fetchedBoundsRef.current) return false;
    const fb = fetchedBoundsRef.current;
    const zoom = Math.round(map.getZoom());
    // If step tier changed (significant zoom), must re-fetch for new resolution
    if (getStep(zoom) !== fb.step) return false;
    const b = map.getBounds();
    const vs = Math.max(-85, b.getSouth()), vn = Math.min(85, b.getNorth());
    const vw = Math.max(-180, b.getWest()), ve = Math.min(180, b.getEast());
    return fb.s <= vs && fb.w <= vw && fb.n >= vn && fb.e >= ve;
  }, [map]);

  const fetchAndRender = useCallback(async () => {
    if (!map || !visible) return;
    const zoom = Math.round(map.getZoom());
    if (zoom >= MAX_ZOOM) {
      cleanup();
      lastGridRef.current = null;
      fetchedBoundsRef.current = null;
      return;
    }

    // If viewport still covered → skip
    if (viewportCovered() && lastGridRef.current) return;

  // Snap to fixed global grid — same area always produces same bbox → same API call
  const { s, w, n, e, step } = snapBbox(map.getBounds(), zoom);

    // 1. Fresh cache hit → render instantly
    const cached = heatGet(s, w, n, e, step, pollutant);
    if (cached) {
      lastGridRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, step };
      renderOverlay(cached, pollutant);
      return;
    }

    // 2. Stale fallback (same step) while fetching fresh
    const fallback = heatGetStale(s, w, n, e, step, pollutant);
    if (fallback) {
      lastGridRef.current = fallback;
      renderOverlay(fallback, pollutant);
      // Don't update fetchedBoundsRef — still need fresh data
    }
    // If no fallback: old overlay stays visible (no cleanup)

    // 3. Fetch fresh
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

  const data = await fetchGridAQI(s, w, n, e, step, pollutant, ac.signal);
    if (!data || data.grid.length === 0 || ac.signal.aborted) return;

  heatSet(s, w, n, e, step, pollutant, data);
    lastGridRef.current = data;
  fetchedBoundsRef.current = { s, w, n, e, step };
    renderOverlay(data, pollutant);
  }, [map, visible, pollutant, cleanup, renderOverlay, viewportCovered]);

  // Pollutant change → re-render from cached grid (0 HTTP)
  useEffect(() => {
    if (lastPollutantRef.current !== pollutant) {
      lastPollutantRef.current = pollutant;
      if (visible && lastGridRef.current) {
        renderOverlay(lastGridRef.current, pollutant);
        return;
      }
    }
    // Visibility toggle or initial
    if (!visible || !map) {
      cleanup();
      controllerRef.current?.abort();
      return;
    }
    fetchAndRender();
    return () => {
      controllerRef.current?.abort();
    };
  }, [visible, pollutant, fetchAndRender, cleanup, map, renderOverlay]);

  // Cleanup overlay on unmount (but don't on every re-render)
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  // ── Map move → leading throttle (500ms) ────────────────────
  useEffect(() => {
    if (!map || !visible) return;
    const onMove = () => {
      // If viewport still covered → skip
      if (viewportCovered() && lastGridRef.current) return;

      const now = Date.now();
      if (now - lastThrottleRef.current > 500) {
        fetchAndRender();
        lastThrottleRef.current = now;
      } else {
        if (trailingRef.current) clearTimeout(trailingRef.current);
        trailingRef.current = setTimeout(() => {
          fetchAndRender();
          lastThrottleRef.current = Date.now();
        }, 500);
      }
    };
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
      if (trailingRef.current) clearTimeout(trailingRef.current);
    };
  }, [map, visible, fetchAndRender, viewportCovered]);
}
