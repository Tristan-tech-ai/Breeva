/**
 * POI Sprite Atlas
 *
 * Rasterizes each POI marker — colored rounded-square background + white glyph —
 * ONCE to an offscreen canvas, caches it, then the canvas POI layer blits it with
 * a single drawImage per feature. This is what makes hundreds of POIs cheap: the
 * expensive part (SVG → raster) happens once per (icon, color, size, variant),
 * never per frame.
 *
 * SVG → canvas needs an <img> with a data URL, which loads ASYNC. Until the glyph
 * image is ready we draw a background-only sprite (a colored square) and don't cache
 * it; when the image loads we fire onReady() so the layer redraws and the sprite is
 * rebuilt — now with the glyph — and cached.
 */

import { getIconSvg, ROOT_COLORS } from './poi-icons';

export type SpriteVariant = 'normal' | 'green';

// Cap DPR at 3 — beyond that the backing store grows quadratically for no visible gain.
function dpr(): number {
  return Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
}

// Full-marker sprites keyed by icon|color|px|variant|dpr.
const spriteCache = new Map<string, HTMLCanvasElement>();
// Glyph images keyed by icon|color. Built once, reused across sprite sizes.
const imgCache = new Map<string, HTMLImageElement>();

let onReadyCb: (() => void) | null = null;
/** The layer registers its redraw here so newly-loaded glyphs get painted in. */
export function setAtlasOnReady(cb: () => void): void {
  onReadyCb = cb;
}

function imgKey(iconKey: string, color: string): string {
  return `${iconKey}|${color}`;
}

/**
 * Returns a ready glyph <img> for (iconKey, color), or null while it loads.
 * White glyph + color-tinted accents (currentColor → the marker color), matching
 * the DOM `.poi-icon-marker svg { color: var(--poi-color) }` rule.
 */
function getGlyphImage(iconKey: string, color: string): HTMLImageElement | null {
  const k = imgKey(iconKey, color);
  const cached = imgCache.get(k);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;

  // Canvas may not honor CSS `color` on a data-URL SVG, so resolve currentColor explicitly.
  const inner = getIconSvg(iconKey).replace(/currentColor/g, color);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${inner}</svg>`;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { onReadyCb?.(); };
  img.onerror = () => { /* leave uncached-as-ready; bg-only sprite is the fallback */ };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  imgCache.set(k, img);
  return null;
}

function roundRectPath(
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

/**
 * A cached marker sprite. CSS size is `px`×`px`; backing store is `px*dpr`. The
 * canvas layer blits it centered on the POI's screen point.
 */
export function getSprite(
  iconKey: string,
  color: string,
  px: number,
  variant: SpriteVariant = 'normal',
): HTMLCanvasElement {
  const r = dpr();
  const key = `${iconKey}|${color}|${px}|${variant}|${r}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = Math.round(px * r);
  c.height = Math.round(px * r);
  const ctx = c.getContext('2d')!;
  ctx.scale(r, r);

  // Background: rounded square, white border (radius scaled from the 8px@28px DOM rule).
  const border = 2;
  const inset = border / 2;
  const w = px - border;
  const radius = px * (8 / 28);
  roundRectPath(ctx, inset, inset, w, w, radius);
  if (variant === 'green') {
    // Baked glow ring for the Ruang Hijau highlight (drawn once — no per-frame cost).
    ctx.save();
    ctx.shadowColor = 'rgba(34,197,94,0.65)';
    ctx.shadowBlur = px * 0.22;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = border;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Glyph: ~half the marker, centered.
  const glyph = getGlyphImage(iconKey, color);
  const gPx = Math.round(px * 0.5);
  const gOff = (px - gPx) / 2;
  if (glyph) {
    try { ctx.drawImage(glyph, gOff, gOff, gPx, gPx); } catch { /* decode race */ }
  }

  // Only cache once the glyph is baked in; bg-only sprites rebuild on the next redraw.
  if (glyph) spriteCache.set(key, c);
  return c;
}

/** Marker size (CSS px) the layer uses; sprites are square so half = px/2. */
export function spriteSize(filtered: boolean): number {
  return filtered ? 36 : 28;
}

/**
 * Warm the glyphs most likely on first paint so the initial frame isn't all squares.
 * Pairs are (iconKey, rootColor) for the common unfiltered categories + filter chips.
 */
export function prewarmAtlas(): void {
  if (typeof window === 'undefined') return;
  const pairs: Array<[string, string]> = [
    ['restaurant', ROOT_COLORS.catering], ['cafe', ROOT_COLORS.catering], ['fast_food', ROOT_COLORS.catering],
    ['store', ROOT_COLORS.commercial], ['supermarket', ROOT_COLORS.commercial], ['convenience', ROOT_COLORS.commercial],
    ['hotel', ROOT_COLORS.accommodation],
    ['park', ROOT_COLORS.leisure],
    ['mosque', ROOT_COLORS.religion],
    ['atm', ROOT_COLORS.service], ['bank', ROOT_COLORS.service], ['fuel', ROOT_COLORS.service],
    ['hospital', ROOT_COLORS.healthcare], ['pharmacy', ROOT_COLORS.healthcare],
    ['school', ROOT_COLORS.education],
    ['generic', '#6b7280'],
  ];
  for (const [k, color] of pairs) getGlyphImage(k, color);
}

/** Drop all cached sprites (e.g. when devicePixelRatio changes across monitors). */
export function clearSpriteCache(): void {
  spriteCache.clear();
}
