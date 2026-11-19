/** Heights of the home page's bottom sheet, in percent of the viewport height, per state (BottomSheet.tsx). */
export const SHEET_HEIGHTS = {
  hidden: 0,
  peek: 28,
  half: 50,
  full: 88,
} as const;

export type SheetState = keyof typeof SHEET_HEIGHTS;

/**
 * X-W54: the map's bottom controls (the data attribution) sit above the sheet instead of under it. The value is set as
 * --sheet-h on the home page and read by `.home-map .leaflet-bottom` in index.css.
 */
export function sheetLift(state: SheetState): string {
  return `${SHEET_HEIGHTS[state]}vh`;
}
