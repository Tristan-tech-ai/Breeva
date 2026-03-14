import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import type { PollutantType } from '../../types';
import { getColorStops } from './RoadPollutionLayer';
import { SpatialTileCache } from '../../lib/spatial-tile-cache';

/**
 * Canvas-based AQI heatmap overlay for low zoom levels (z < 11).
 * Fetches gridded AQ data from /api/vayu/grid-aqi, renders bilinear-interpolated
 * canvas overlay via L.ImageOverlay.
 */

interface GridAQIResponse {
  grid: number[];
  rows: number;
  cols: number;
  bounds: { south: number; west: number; north: number; east: number };
  pollutant: string;
}

// Singleton grid cache (persists across re-renders, 10-min TTL)
const gridCache = new SpatialTileCache<GridAQIResponse>(20, 10);

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

// ── Render grid to canvas ────────────────────────────────────

function renderHeatmapCanvas(
  data: GridAQIResponse,
  pollutant: PollutantType,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
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
// Canvas size: larger for less-pixelated output
const CANVAS_SIZE = 384;

export function useAQIHeatmapLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
): void {
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const lastPollutantRef = useRef(pollutant);
  const lastGridRef = useRef<GridAQIResponse | null>(null);

  const cleanup = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
  }, []);

  // Re-render existing grid data with new pollutant (0 HTTP)
  const rerenderCurrent = useCallback(() => {
    if (!map || !lastGridRef.current) return;
    const data = lastGridRef.current;
    const dataUrl = renderHeatmapCanvas(data, pollutant, CANVAS_SIZE, CANVAS_SIZE);
    if (!dataUrl) return;
    cleanup();
    const imageBounds = L.latLngBounds(
      [data.bounds.south, data.bounds.west],
      [data.bounds.north, data.bounds.east],
    );
    overlayRef.current = L.imageOverlay(dataUrl, imageBounds, {
      opacity: 1,
      interactive: false,
      zIndex: 200,
    }).addTo(map);
  }, [map, pollutant, cleanup]);

  const fetchAndRender = useCallback(async () => {
    if (!map || !visible) return;
    const zoom = map.getZoom();
    if (zoom >= MAX_ZOOM) {
      cleanup();
      lastGridRef.current = null;
      return;
    }

    const bounds = map.getBounds();
    const s = bounds.getSouth(), w = bounds.getWest();
    const n = bounds.getNorth(), e = bounds.getEast();

    // Fresh cache hit → render instantly
    const cached = gridCache.get(s, w, n, e, zoom);
    if (cached) {
      lastGridRef.current = cached;
      const dataUrl = renderHeatmapCanvas(cached, pollutant, CANVAS_SIZE, CANVAS_SIZE);
      if (!dataUrl) return;
      cleanup();
      overlayRef.current = L.imageOverlay(
        dataUrl,
        L.latLngBounds([cached.bounds.south, cached.bounds.west], [cached.bounds.north, cached.bounds.east]),
        { opacity: 1, interactive: false, zIndex: 200 },
      ).addTo(map);
      return;
    }

    // Stale data → show immediately
    const stale = gridCache.getStale(s, w, n, e, zoom);
    if (stale) {
      lastGridRef.current = stale;
      const dataUrl = renderHeatmapCanvas(stale, pollutant, CANVAS_SIZE, CANVAS_SIZE);
      if (dataUrl) {
        cleanup();
        overlayRef.current = L.imageOverlay(
          dataUrl,
          L.latLngBounds([stale.bounds.south, stale.bounds.west], [stale.bounds.north, stale.bounds.east]),
          { opacity: 1, interactive: false, zIndex: 200 },
        ).addTo(map);
      }
    }

    // Abort previous, fetch fresh
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    const data = await fetchGridAQI(s, w, n, e, zoom, pollutant, ac.signal);
    if (!data || data.grid.length === 0 || ac.signal.aborted) return;

    gridCache.set(s, w, n, e, zoom, data);
    lastGridRef.current = data;

    const dataUrl = renderHeatmapCanvas(data, pollutant, CANVAS_SIZE, CANVAS_SIZE);
    if (!dataUrl) return;
    cleanup();
    overlayRef.current = L.imageOverlay(
      dataUrl,
      L.latLngBounds([data.bounds.south, data.bounds.west], [data.bounds.north, data.bounds.east]),
      { opacity: 1, interactive: false, zIndex: 200 },
    ).addTo(map);
  }, [map, visible, pollutant, cleanup]);

  // Pollutant change → re-render from cached grid (0 HTTP)
  useEffect(() => {
    if (lastPollutantRef.current !== pollutant) {
      lastPollutantRef.current = pollutant;
      if (visible && lastGridRef.current) {
        rerenderCurrent();
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
      cleanup();
    };
  }, [visible, pollutant, fetchAndRender, cleanup, map, rerenderCurrent]);

  // Map move → debounced 400ms
  useEffect(() => {
    if (!map || !visible) return;
    const onMove = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchAndRender, 400);
    };
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map, visible, fetchAndRender]);
}
