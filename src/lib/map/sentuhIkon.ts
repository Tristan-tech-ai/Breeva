/**
 * M-U11: whether a tap lands on a place icon. A place icon takes the tap only within a circle of at most 14 px (it used
 * to take a 52 px square, so a tap on the coloured road next to a dense row of icons opened a place sheet instead of the
 * road card); a cluster keeps its wider box because nothing else is drawn under it.
 */
export const TAP_IKON_PX = 14;

export function kenaIkon(dx: number, dy: number, half: number, cluster: boolean): boolean {
  if (cluster) return Math.abs(dx) <= half + 4 && Math.abs(dy) <= half + 4;
  return Math.hypot(dx, dy) <= Math.min(half, TAP_IKON_PX);
}
