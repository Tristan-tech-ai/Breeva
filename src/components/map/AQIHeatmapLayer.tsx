import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import type { PollutantType } from '../../types';
import { getColorStops } from './RoadPollutionLayer';

/**
 * Canvas-based AQI heatmap overlay for low zoom levels (z < 11).
 * Replaces circle fallback with a real raster heatmap (eLichens screenshot #8 style).
 *
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
): Promise<GridAQIResponse | null> {
  // Grid resolution scales with zoom
  const gridRes = zoom <= 4 ? 4 : zoom <= 7 ? 6 : 8;
  try {
    const params = new URLSearchParams({
      south: south.toFixed(4),
      west: west.toFixed(4),
      north: north.toFixed(4),
      east: east.toFixed(4),
      res: String(gridRes),
      pollutant,
    });
    const resp = await fetch(`/api/vayu/grid-aqi?${params}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────

const MAX_ZOOM = 11; // heatmap only at z < 11
const CANVAS_SIZE = 256; // canvas resolution

export function useAQIHeatmapLayer(
  map: L.Map | null,
  visible: boolean,
  pollutant: PollutantType = 'aqi',
): void {
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef(false);

  const cleanup = useCallback(() => {
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
  }, []);

  const fetchAndRender = useCallback(async () => {
    if (!map || !visible) return;
    const zoom = map.getZoom();
    if (zoom >= MAX_ZOOM) {
      cleanup();
      return;
    }

    const bounds = map.getBounds();
    const data = await fetchGridAQI(
      bounds.getSouth(), bounds.getWest(),
      bounds.getNorth(), bounds.getEast(),
      zoom, pollutant,
    );

    if (abortRef.current || !data || data.grid.length === 0) return;

    const dataUrl = renderHeatmapCanvas(data, pollutant, CANVAS_SIZE, CANVAS_SIZE);
    if (!dataUrl) return;

    // Remove previous overlay
    cleanup();

    // Create new image overlay covering the fetched bounds
    const imageBounds = L.latLngBounds(
      [data.bounds.south, data.bounds.west],
      [data.bounds.north, data.bounds.east],
    );
    overlayRef.current = L.imageOverlay(dataUrl, imageBounds, {
      opacity: 1, // alpha already baked into canvas
      interactive: false,
      zIndex: 200,
    }).addTo(map);
  }, [map, visible, pollutant, cleanup]);

  // Visibility toggle
  useEffect(() => {
    abortRef.current = false;
    if (!visible || !map) {
      cleanup();
      return;
    }
    fetchAndRender();
    return () => {
      abortRef.current = true;
      cleanup();
    };
  }, [visible, pollutant, fetchAndRender, cleanup, map]);

  // Re-render on pan/zoom (debounced)
  useEffect(() => {
    if (!map || !visible) return;
    const onMove = () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(fetchAndRender, 600);
    };
    map.on('moveend', onMove);
    map.on('zoomend', onMove);
    return () => {
      map.off('moveend', onMove);
      map.off('zoomend', onMove);
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    };
  }, [map, visible, fetchAndRender]);
}
