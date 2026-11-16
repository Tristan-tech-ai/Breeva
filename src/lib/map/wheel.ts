/**
 * Mouse wheel over a map embedded in a scrolling page (task X-H1): the wheel scrolls the page, and zooms the map only
 * with Ctrl or Cmd held (browsers also send a trackpad pinch as a wheel event with ctrlKey). Wheel deltas accumulate
 * so one mouse notch (about 100 px) is one zoom level and a pinch zooms smoothly instead of a level per event.
 */
export const NOTCH_PX = 100;

export interface WheelLike { ctrlKey: boolean; metaKey: boolean; deltaY: number; deltaMode?: number }

/** deltaMode 1 = lines, 2 = pages (Firefox with some mice); converted to pixels. */
function px(e: WheelLike): number {
  return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
}

/**
 * Next accumulator and what to do: step +1 zooms in, -1 out, 0 nothing yet; hint true when the wheel was used
 * without the modifier (the page scrolls and the map says how to zoom).
 */
export function wheelStep(acc: number, e: WheelLike): { acc: number; step: -1 | 0 | 1; hint: boolean } {
  if (!e.ctrlKey && !e.metaKey) return { acc: 0, step: 0, hint: true };
  const a = acc + px(e);
  // the remainder carries over, so a long pinch zooms by its full length
  if (a <= -NOTCH_PX) return { acc: a + NOTCH_PX, step: 1, hint: false };
  if (a >= NOTCH_PX) return { acc: a - NOTCH_PX, step: -1, hint: false };
  return { acc: a, step: 0, hint: false };
}
