/**
 * Label Collision Avoidance Engine
 *
 * Greedy screen-space collision detection with 4-direction placement,
 * priority-based ordering, zoom label budgets, and frame-coherent stability.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface LabelCandidate {
  id: string;
  screenX: number;
  screenY: number;
  name: string;
  /** Lower = higher priority (matches minZoom from poi-icons) */
  priority: number;
  markerSize: number;
}

export interface LabelPlacement {
  show: boolean;
  direction: 'top' | 'right' | 'bottom' | 'left';
  offset: [number, number];
  displayName: string;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ── Label measurement (off-screen canvas) ────────────────────────────

let _measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCtx) {
    const c = document.createElement('canvas');
    _measureCtx = c.getContext('2d')!;
    _measureCtx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }
  return _measureCtx;
}

function measureText(text: string): number {
  return getMeasureCtx().measureText(text).width;
}

const LABEL_PAD_X = 8;  // css padding (2×6) + border
const LABEL_PAD_Y = 8;  // css padding (2×2) + border + breathing room
const LABEL_HEIGHT = 18; // 11px font-size + padding
const MAX_LABEL_WIDTH = 140;
const GAP = 4; // minimum gap between label edge and occupied rect

// ── Text truncation ──────────────────────────────────────────────────

function truncate(name: string, maxWidth: number): string {
  const w = measureText(name) + LABEL_PAD_X;
  if (w <= maxWidth) return name;

  // Binary search for max fitting chars
  let lo = 1, hi = name.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureText(name.slice(0, mid) + '…') + LABEL_PAD_X <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 2 ? name.slice(0, lo) + '…' : name.slice(0, 3) + '…';
}

// ── Rect helpers ─────────────────────────────────────────────────────

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Compute label rect at a given direction relative to screen point
function labelRect(
  sx: number, sy: number,
  lw: number, lh: number,
  dir: 'top' | 'right' | 'bottom' | 'left',
  markerHalf: number,
): Rect {
  switch (dir) {
    case 'top':
      return {
        left: sx - lw / 2 - GAP,
        top: sy - markerHalf - lh - GAP,
        right: sx + lw / 2 + GAP,
        bottom: sy - markerHalf + GAP,
      };
    case 'right':
      return {
        left: sx + markerHalf - GAP,
        top: sy - lh / 2 - GAP,
        right: sx + markerHalf + lw + GAP,
        bottom: sy + lh / 2 + GAP,
      };
    case 'bottom':
      return {
        left: sx - lw / 2 - GAP,
        top: sy + markerHalf - GAP,
        right: sx + lw / 2 + GAP,
        bottom: sy + markerHalf + lh + GAP,
      };
    case 'left':
      return {
        left: sx - markerHalf - lw - GAP,
        top: sy - lh / 2 - GAP,
        right: sx - markerHalf + GAP,
        bottom: sy + lh / 2 + GAP,
      };
  }
}

// Leaflet tooltip offset for a given direction
function dirOffset(dir: 'top' | 'right' | 'bottom' | 'left', markerHalf: number): [number, number] {
  switch (dir) {
    case 'top':    return [0, -markerHalf];
    case 'right':  return [markerHalf, 0];
    case 'bottom': return [0, markerHalf];
    case 'left':   return [-markerHalf, 0];
  }
}

// ── Occupancy grid (spatial index for fast collision) ────────────────

const CELL = 64;

class OccupancyGrid {
  private cells = new Map<number, Rect[]>();

  private cellKey(cx: number, cy: number): number {
    return (cx + 500) * 10000 + (cy + 500); // safe for screens up to ~32000px
  }

  insert(r: Rect): void {
    const cxMin = Math.floor(r.left / CELL);
    const cxMax = Math.floor(r.right / CELL);
    const cyMin = Math.floor(r.top / CELL);
    const cyMax = Math.floor(r.bottom / CELL);
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const k = this.cellKey(cx, cy);
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(r);
      }
    }
  }

  overlaps(r: Rect): boolean {
    const cxMin = Math.floor(r.left / CELL);
    const cxMax = Math.floor(r.right / CELL);
    const cyMin = Math.floor(r.top / CELL);
    const cyMax = Math.floor(r.bottom / CELL);
    const seen = new Set<Rect>();
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const arr = this.cells.get(this.cellKey(cx, cy));
        if (!arr) continue;
        for (const other of arr) {
          if (seen.has(other)) continue;
          seen.add(other);
          if (rectsOverlap(r, other)) return true;
        }
      }
    }
    return false;
  }

  clear(): void {
    this.cells.clear();
  }
}

// ── Frame-coherent stability ─────────────────────────────────────────

let prevLabeledIds = new Set<string>();

// ── Zoom label budget ────────────────────────────────────────────────

function maxLabels(zoom: number, isFiltered: boolean): number {
  if (isFiltered) return 200; // Show as many labels as possible when filtered
  if (zoom < 15) return 0;
  if (zoom < 16) return 15;
  if (zoom < 17) return 30;
  if (zoom < 18) return 60;
  if (zoom < 19) return 100;
  return 150;
}

// ── Direction preference ─────────────────────────────────────────────

const DIRECTIONS: Array<'top' | 'right' | 'bottom' | 'left'> = ['top', 'right', 'bottom', 'left'];

// ── Main resolver ────────────────────────────────────────────────────

export function resolveLabels(
  candidates: LabelCandidate[],
  zoom: number,
  isFiltered = false,
): Map<string, LabelPlacement> {
  const result = new Map<string, LabelPlacement>();
  const budget = maxLabels(zoom, isFiltered);

  if (budget === 0 || candidates.length === 0) {
    // Everything icon-only
    for (const c of candidates) {
      result.set(c.id, { show: false, direction: 'top', offset: [0, -14], displayName: c.name });
    }
    prevLabeledIds = new Set();
    return result;
  }

  // Sort: lower priority number = more important = placed first.
  // Stability bonus: previously labeled POIs get slight bump.
  const sorted = [...candidates].sort((a, b) => {
    const aPrio = a.priority - (prevLabeledIds.has(a.id) ? 0.5 : 0);
    const bPrio = b.priority - (prevLabeledIds.has(b.id) ? 0.5 : 0);
    if (aPrio !== bPrio) return aPrio - bPrio;
    // Tiebreak: shorter names (less visual clutter)
    return a.name.length - b.name.length;
  });

  const grid = new OccupancyGrid();
  let placed = 0;
  const newLabeledIds = new Set<string>();

  // Place labels greedily — labels only need to avoid other labels,
  // not marker icons (28px icons are small enough that overlapping labels look fine)
  for (const c of sorted) {
    if (placed >= budget) {
      result.set(c.id, { show: false, direction: 'top', offset: [0, -14], displayName: c.name });
      continue;
    }

    const displayName = truncate(c.name, MAX_LABEL_WIDTH);
    const lw = measureText(displayName) + LABEL_PAD_X;
    const lh = LABEL_HEIGHT + LABEL_PAD_Y;
    const halfM = c.markerSize / 2;

    let bestDir: 'top' | 'right' | 'bottom' | 'left' | null = null;

    for (const dir of DIRECTIONS) {
      const rect = labelRect(c.screenX, c.screenY, lw, lh, dir, halfM);
      if (!grid.overlaps(rect)) {
        bestDir = dir;
        grid.insert(rect);
        break;
      }
    }

    if (bestDir) {
      placed++;
      newLabeledIds.add(c.id);
      result.set(c.id, {
        show: true,
        direction: bestDir,
        offset: dirOffset(bestDir, halfM),
        displayName,
      });
    } else {
      result.set(c.id, { show: false, direction: 'top', offset: [0, -14], displayName: c.name });
    }
  }

  prevLabeledIds = newLabeledIds;
  return result;
}
