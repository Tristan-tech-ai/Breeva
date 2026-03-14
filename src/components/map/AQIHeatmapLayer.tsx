import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import type { PollutantType } from '../../types';
import { getColorStops } from './RoadPollutionLayer';
import { SpatialTileCache } from '../../lib/spatial-tile-cache';

/**
 * Canvas-based AQI heatmap overlay for low zoom levels (z < 11).
 * Fetches gridded AQ data from /api/vayu/grid-aqi, renders bilinear-interpolated
 * canvas overlay via L.ImageOverlay.
 *
 * Zero-delay techniques:
 * - Persistent canvas (reuse instead of createElement each render)
 * - Atomic overlay swap (setUrl + setBounds on existing overlay)
 * - Leading throttle instead of debounce
 * - Viewport padding for over-fetch
 * - Mip-map fallback across zoom levels
 * - Old overlay stays until new one is ready
 */

interface GridAQIResponse {
  grid: number[];
  rows: number;
  cols: number;
  bounds: { south: number; west: number; north: number; east: number };
  pollutant: string;
}

// Singleton grid cache: 30 entries, 15-min TTL
const gridCache = new SpatialTileCache<GridAQIResponse>(30, 15);

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

async function fetchGridAQI(
  south: number, west: number, north: number, east: number,
  zoom: number, pollutant: string,
  signal?: AbortSignal,
): Promise<GridAQIResponse | null> {
  // Higher grid resolution: fewer gaps at low zoom
  const gridRes = zoom <= 4 ? 6 : zoom <= 6 ? 8 : zoom <= 8 ? 10 : 12;
  try {
    const params = new URLSearchParams({
      south: south.toFixed(4), west: west.toFixed(4),
      north: north.toFixed(4), east: east.toFixed(4),
      res: String(gridRes), pollutant,
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
  const fetchedBoundsRef = useRef<{ s: number; w: number; n: number; e: number; z: number } | null>(null);
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

  // Check if viewport is still covered
  const viewportCovered = useCallback((): boolean => {
    if (!map || !fetchedBoundsRef.current) return false;
    const b = map.getBounds();
    const z = Math.round(map.getZoom());
    const fb = fetchedBoundsRef.current;
    return fb.z === z
      && fb.s <= b.getSouth() && fb.w <= b.getWest()
      && fb.n >= b.getNorth() && fb.e >= b.getEast();
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

    // Pad viewport by 50% for over-fetch
    const bounds = map.getBounds().pad(0.5);
    const s = bounds.getSouth(), w = bounds.getWest();
    const n = bounds.getNorth(), e = bounds.getEast();

    // 1. Fresh cache hit → render instantly
    const cached = gridCache.get(s, w, n, e, zoom);
    if (cached) {
      lastGridRef.current = cached;
      fetchedBoundsRef.current = { s, w, n, e, z: zoom };
      renderOverlay(cached, pollutant);
      return;
    }

    // 2. Fallback: stale / nearest-zoom / any overlapping → show immediately
    const fallback = gridCache.getStale(s, w, n, e, zoom)
      ?? gridCache.getNearestZoom(s, w, n, e, zoom)
      ?? gridCache.getAnyOverlapping(s, w, n, e, zoom);
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

    const data = await fetchGridAQI(s, w, n, e, zoom, pollutant, ac.signal);
    if (!data || data.grid.length === 0 || ac.signal.aborted) return;

    gridCache.set(s, w, n, e, zoom, data);
    lastGridRef.current = data;
    fetchedBoundsRef.current = { s, w, n, e, z: zoom };
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
