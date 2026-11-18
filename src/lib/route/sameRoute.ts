/** True when two routes use the same edges in the same order (the motor emergency and two-number searches can agree). */
export function sameRoute(a: { edges: ArrayLike<number> }, b: { edges: ArrayLike<number> }): boolean {
  if (a.edges.length !== b.edges.length) return false;
  for (let k = 0; k < a.edges.length; k++) if (a.edges[k] !== b.edges[k]) return false;
  return true;
}
