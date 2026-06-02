/**
 * POICanvasLayer — single-canvas, "static but interactive" POI renderer.
 *
 * Why this exists: rendering hundreds of POIs as Leaflet DOM markers (L.divIcon) +
 * permanent tooltips tanks mobile FPS — every pan reconciles 150+ DOM nodes, each with
 * box-shadows and (formerly) backdrop-blur labels. Here ALL non-merchant POIs are drawn
 * onto ONE <canvas> in a dedicated map pane. During a pan Leaflet translates the pane
 * (GPU compositor only) so the canvas rides along with zero JS redraw — 60fps drag.
 * Features are recomputed + redrawn only on move/zoom END (debounced, off the frame path).
 * Interactivity is hit-testing on tap, not DOM. Mirrors how Google/Mapbox stay smooth.
 *
 * Coordinate recipe (standard Leaflet canvas-overlay): the canvas lives in a pane (child
 * of the transforming _mapPane) and is positioned at the layer-point of the viewport's
 * top-left corner; features are drawn at their CONTAINER points. So during a drag the pane
 * transform keeps everything glued; on moveend we re-anchor + redraw.
 */

import L from 'leaflet';
import type { POI } from '../../lib/poi-api';
import type { ClusterFeature } from '../../lib/poi-cluster';
import type { LabelPlacement } from '../../lib/label-collision';
import { getSprite, spriteSize, setAtlasOnReady, clearSpriteCache, prewarmAtlas } from '../../lib/poi-sprite-atlas';
import { resolveIcon, isGreenSpace } from '../../lib/poi-icons';

export interface ComputeResult {
  features: ClusterFeature[];
  placements: Map<string, LabelPlacement>;
  /** lg markers when a category filter is active */
  filtered: boolean;
  /** Ruang Hijau highlight → green glyph + glow for green spaces */
  highlightGreen: boolean;
  /** cluster bubble tint when a filter is active (matches the chip color) */
  clusterColor?: string;
}

interface DrawnHit {
  isCluster: boolean;
  cx: number;
  cy: number;
  half: number;
  poi?: POI;
  lat: number;
  lng: number;
  expansionZoom?: number;
}

const LABEL_FONT = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function clusterDiameter(count: number): number {
  return count < 10 ? 30 : count < 50 ? 34 : count < 100 ? 38 : 42;
}

export class POICanvasLayer {
  private map: L.Map | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: ComputeResult | null = null;
  private hits: DrawnHit[] = [];
  private selectedId: string | null = null;
  private dark = false;
  private compute: ((bounds: L.LatLngBounds, zoom: number) => ComputeResult | null) | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private rafPending = false;
  private dprValue = 1;

  /** Assigned by the host (POILayer) — keeps the navigate-vs-sheet decision in React. */
  onPointTap: ((poi: POI) => void) | null = null;
  onClusterTap: ((lat: number, lng: number, expansionZoom: number) => void) | null = null;

  attach(map: L.Map): void {
    this.map = map;
    prewarmAtlas(); // warm common glyphs so the first paint isn't all squares
    let pane = map.getPane('poiCanvas');
    if (!pane) {
      pane = map.createPane('poiCanvas');
      pane.style.zIndex = '450'; // above overlayPane/roads (400), below markerPane (600)
      pane.style.pointerEvents = 'none';
    }
    const canvas = L.DomUtil.create('canvas', 'poi-canvas-layer', pane) as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    setAtlasOnReady(() => this._scheduleDraw());
    map.on('moveend zoomend resize', this._onViewEnd, this);
    map.on('zoomstart', this._onZoomStart, this);
    map.on('zoomend', this._onZoomEnd, this);
    // Expose to MapController so its map-click handler can defer to a POI hit
    // before setting a destination (sibling click handlers can't be stopped otherwise).
    (map as unknown as { __poiCanvasLayer?: POICanvasLayer }).__poiCanvasLayer = this;
    this._recompute();
  }

  detach(): void {
    const map = this.map;
    if (!map) return;
    map.off('moveend zoomend resize', this._onViewEnd, this);
    map.off('zoomstart', this._onZoomStart, this);
    map.off('zoomend', this._onZoomEnd, this);
    const holder = map as unknown as { __poiCanvasLayer?: POICanvasLayer };
    if (holder.__poiCanvasLayer === this) delete holder.__poiCanvasLayer;
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.canvas = null;
    this.ctx = null;
    this.data = null;
    this.hits = [];
    this.map = null;
  }

  setCompute(fn: (bounds: L.LatLngBounds, zoom: number) => ComputeResult | null): void {
    this.compute = fn;
  }
  setStyleContext(ctx: { dark?: boolean }): void {
    if (ctx.dark !== undefined) this.dark = ctx.dark;
  }
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this._scheduleDraw();
  }
  /** Recompute features for the current view + redraw (call when data/filter changes). */
  refresh(): void {
    this._recompute();
  }
  clear(): void {
    this.data = null;
    this.hits = [];
    this._scheduleDraw();
  }

  /** Hit-test a tap; if it lands on a POI/cluster, perform the action + return true. */
  tapAt(containerPoint: L.Point): boolean {
    // Reverse order = topmost first (points are drawn after clusters; selected last).
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      const pad = h.isCluster ? 4 : 6; // finger-friendly slop on points
      if (Math.abs(containerPoint.x - h.cx) <= h.half + pad &&
          Math.abs(containerPoint.y - h.cy) <= h.half + pad) {
        if (h.isCluster) this.onClusterTap?.(h.lat, h.lng, h.expansionZoom ?? 0);
        else if (h.poi) this.onPointTap?.(h.poi);
        return true;
      }
    }
    return false;
  }

  // ── internals ──────────────────────────────────────────────────────

  private _onZoomStart(): void {
    // A static canvas can't track the zoom tween without drift — hide, then redraw on end.
    if (this.canvas) this.canvas.style.opacity = '0';
  }
  private _onZoomEnd(): void {
    if (this.canvas) this.canvas.style.opacity = '1';
  }
  private _onViewEnd(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(() => this._recompute(), 90);
  }

  private _recompute(): void {
    if (!this.map) return;
    if (this.compute) {
      try {
        this.data = this.compute(this.map.getBounds(), this.map.getZoom());
      } catch {
        /* keep last data on a transient compute error */
      }
    }
    this._positionAndDraw();
  }

  private _scheduleDraw(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this._positionAndDraw();
    });
  }

  private _positionAndDraw(): void {
    const map = this.map, canvas = this.canvas, ctx = this.ctx;
    if (!map || !canvas || !ctx) return;
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return; // hidden / zero-size container (tab switch)

    const r = Math.min(window.devicePixelRatio || 1, 3);
    if (r !== this.dprValue) {
      this.dprValue = r;
      clearSpriteCache(); // sprites are baked at DPR; rebuild if it changed (monitor move)
    }
    if (canvas.width !== Math.round(size.x * r) || canvas.height !== Math.round(size.y * r)) {
      canvas.width = Math.round(size.x * r);
      canvas.height = Math.round(size.y * r);
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
    }
    // Anchor the canvas to the viewport's top-left in layer space; draw at container points.
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    this._draw(ctx, size.x, size.y, r);
  }

  private _draw(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
    ctx.setTransform(r, 0, 0, r, 0, 0); // every redraw — guards resize / DPR change
    ctx.clearRect(0, 0, w, h);
    this.hits = [];
    const data = this.data;
    const map = this.map;
    if (!data || !map) return;

    const clusters: Array<Extract<ClusterFeature, { type: 'cluster' }>> = [];
    const points: Array<Extract<ClusterFeature, { type: 'point' }>> = [];
    for (const f of data.features) {
      if (f.type === 'cluster') clusters.push(f);
      else points.push(f);
    }

    // 1) Clusters
    for (const c of clusters) {
      const p = map.latLngToContainerPoint([c.lat, c.lng]);
      this._drawCluster(ctx, p.x, p.y, c.count, data.clusterColor);
      this.hits.push({
        isCluster: true, cx: p.x, cy: p.y, half: clusterDiameter(c.count) / 2,
        lat: c.lat, lng: c.lng, expansionZoom: c.expansionZoom,
      });
    }

    // 2) Point icons (selected drawn last so its ring sits on top)
    const px = spriteSize(data.filtered);
    const ordered = this.selectedId
      ? [...points].sort((a, b) => (a.id === this.selectedId ? 1 : 0) - (b.id === this.selectedId ? 1 : 0))
      : points;
    for (const pt of ordered) {
      const p = map.latLngToContainerPoint([pt.lat, pt.lng]);
      const greenHi = data.highlightGreen && isGreenSpace(pt.poi.types || []);
      const { iconKey, color } = resolveIcon(pt.poi.types || []);
      const sprite = getSprite(iconKey, greenHi ? '#16a34a' : color, px, greenHi ? 'green' : 'normal');
      ctx.drawImage(sprite, p.x - px / 2, p.y - px / 2, px, px);
      if (pt.id === this.selectedId) this._drawRing(ctx, p.x, p.y, px / 2);
      this.hits.push({ isCluster: false, cx: p.x, cy: p.y, half: px / 2, poi: pt.poi, lat: pt.lat, lng: pt.lng });
    }

    // 3) Labels last (on top of all icons), solid bg — no blur
    ctx.font = LABEL_FONT;
    for (const pt of points) {
      const pl = data.placements.get(pt.id);
      if (!pl || !pl.show) continue;
      const p = map.latLngToContainerPoint([pt.lat, pt.lng]);
      this._drawLabel(ctx, p.x, p.y, pl, px / 2);
    }
  }

  private _drawCluster(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, color?: string): void {
    const d = clusterDiameter(count);
    const radius = d / 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (color) {
      ctx.fillStyle = color;
    } else {
      const g = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
      g.addColorStop(0, '#10b981');
      g.addColorStop(1, '#059669');
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count >= 1000 ? `${Math.round(count / 1000)}k` : String(count), x, y + 0.5);
  }

  private _drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, half: number): void {
    ctx.beginPath();
    ctx.arc(x, y, half + 6, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(59,130,246,0.35)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, half + 4, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
    ctx.stroke();
  }

  private _drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, pl: LabelPlacement, half: number): void {
    const text = pl.displayName;
    const padX = 6, padY = 3, lineH = 13, gap = 3;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = lineH + padY * 2;
    let bx = x - bw / 2, by = y - half - gap - bh;
    switch (pl.direction) {
      case 'top':    bx = x - bw / 2;        by = y - half - gap - bh; break;
      case 'bottom': bx = x - bw / 2;        by = y + half + gap;      break;
      case 'right':  bx = x + half + gap;    by = y - bh / 2;          break;
      case 'left':   bx = x - half - gap - bw; by = y - bh / 2;        break;
    }
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fillStyle = this.dark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
    ctx.stroke();
    ctx.fillStyle = this.dark ? '#e5e7eb' : '#1f2937';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, by + bh / 2 + 0.5);
  }
}
