/**
 * On-device router over a walking graph pack (BGR1), LAMPIRAN_TEKNIS L5.2.
 *
 *   cost_w(e) = t_e * (1 + w * p_e)      t_e travel time (s), p_e normalised exposure of the edge (>= 0)
 *
 * A* with the straight-line distance over the top speed as heuristic (admissible: every cost is at least the time).
 * pareto() returns the supported solutions between the fastest (w = 0) and the cleanest (w = wMax) route, found by
 * the weight w* = (T2 - T1) / (P1 - P2) between neighbouring solutions, as in L5.2. Pure: no DOM, runs in a Worker.
 */
import type { WalkGraph } from './walkGraph';

export interface RouteResult {
  nodes: number[];
  edges: number[];
  lengthM: number;
  /** Travel time, seconds. */
  timeS: number;
  /** Sum of p_e * t_e (exposure-seconds, in the units of p). */
  exposure: number;
  /** Sum of imposedOf(e) * t_e along the route (harga hirup times the mode's emission share, per second). */
  imposed: number;
  w: number;
}

const R = 6371008.8;
const RAD = Math.PI / 180;

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  const y = (lat2 - lat1) * RAD;
  return R * Math.hypot(x, y);
}

/** Min-heap of (key, node) with lazy deletion. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export interface SearchOptions {
  /** Speed, m/s; with speedOf, the top speed (keeps the A* heuristic admissible). */
  speed: number;
  /** Speed of edge e, m/s (at most speed); speed for every edge when omitted. */
  speedOf?: (e: number) => number;
  /** False for an edge the route may not use (mode access, zona napas); every edge allowed when omitted. */
  allowed?: (e: number) => boolean;
  /** Normalised exposure of edge e (>= 0); 0 when omitted. */
  exposureOf?: (e: number) => number;
  /** Imposed exposure rate of edge e (harga hirup times the mode's emission share), per second; 0 when omitted. */
  imposedOf?: (e: number) => number;
  /** Weight of imposed exposure in the cost (lambda * epsilon_m); 0 for walking and cycling. */
  lambda?: number;
}

/** Cheapest route from node s to node t for weight w, or null when t is unreachable. */
export function route(g: WalkGraph, s: number, t: number, w: number, o: SearchOptions): RouteResult | null {
  const n = g.n;
  const dist = new Float64Array(n).fill(Infinity);
  const prevE = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const tLat = g.nodeLat(t), tLon = g.nodeLon(t);
  const hOf = (u: number) => distM(g.nodeLat(u), g.nodeLon(u), tLat, tLon) / o.speed;
  const exp = o.exposureOf, imp = o.imposedOf, lam = o.lambda ?? 0, spd = o.speedOf, ok = o.allowed;
  const heap = new Heap();
  dist[s] = 0;
  heap.push(hOf(s), s);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === t) break;
    const du = dist[u];
    for (let e = g.off[u], end = g.off[u + 1]; e < end; e++) {
      const v = g.target[e];
      if (done[v] || (ok && !ok(e))) continue;
      const len = g.lenDm[e] / 10;
      const te = len / (spd ? spd(e) : o.speed);
      // c_e = t_e (1 + w E_e + lambda H_e): own exposure and the exposure the trip imposes, both per unit of time
      let c = te * (1 + (w > 0 && exp ? w * exp(e) : 0));
      if (lam > 0 && imp) c += lam * imp(e) * te;
      const nd = du + c;
      if (nd < dist[v]) {
        dist[v] = nd;
        prevE[v] = e;
        heap.push(nd + hOf(v), v);
      }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const edges: number[] = [];
  const nodes: number[] = [t];
  // walk back: the source of edge e is the node whose CSR range holds it
  for (let v = t; v !== s;) {
    const e = prevE[v];
    edges.push(e);
    const u = sourceOf(g, e);
    nodes.push(u);
    v = u;
  }
  edges.reverse(); nodes.reverse();
  let lengthM = 0, exposure = 0, imposed = 0, timeS = 0;
  for (const e of edges) {
    const len = g.lenDm[e] / 10;
    const te = len / (spd ? spd(e) : o.speed);
    lengthM += len; timeS += te;
    exposure += (exp ? exp(e) : 0) * te;
    imposed += (imp ? imp(e) : 0) * te;
  }
  return { nodes, edges, lengthM, timeS, exposure, imposed, w };
}

/** Source node of directed edge e (binary search in the CSR offsets). */
export function sourceOf(g: WalkGraph, e: number): number {
  let lo = 0, hi = g.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.off[mid] <= e) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Supported Pareto routes (time vs exposure) between w = 0 and w = wMax, at most maxRoutes, sorted fastest first.
 * Routes with the same edges are kept once.
 */
export function pareto(g: WalkGraph, s: number, t: number, o: SearchOptions & { wMax?: number; maxRoutes?: number }): RouteResult[] {
  const wMax = o.wMax ?? 8;
  const maxRoutes = o.maxRoutes ?? 6;
  const fast = route(g, s, t, 0, o);
  if (!fast) return [];
  const clean = route(g, s, t, wMax, o)!;
  const key = (r: RouteResult) => r.edges.join(',');
  const found = new Map<string, RouteResult>([[key(fast), fast], [key(clean), clean]]);
  const queue: Array<[RouteResult, RouteResult]> = [[fast, clean]];
  while (queue.length && found.size < maxRoutes) {
    const [a, b] = queue.shift()!;
    if (!(a.exposure > b.exposure && b.timeS > a.timeS)) continue;
    const ws = (b.timeS - a.timeS) / (a.exposure - b.exposure);
    const r = route(g, s, t, ws, o)!;
    const k = key(r);
    if (found.has(k)) continue;
    // a new supported solution strictly between a and b
    const ca = a.timeS + ws * a.exposure, cr = r.timeS + ws * r.exposure;
    if (cr >= ca - 1e-9) continue;
    found.set(k, r);
    queue.push([a, r], [r, b]);
  }
  return [...found.values()].sort((x, y) => x.timeS - y.timeS);
}

/**
 * Share of extra time a walking route may take over the fastest one to breathe less exhaust (T7, 27 Nov 2026). Chosen by
 * a rule written before the bench ran: the smallest of 0.10, 0.15, 0.25, 0.35, 0.50 that reaches 85 % of the median dose
 * reduction of 0.50 in both regions (200 seeded pairs each on the published field, t7_bangku_2026-11-27.json).
 */
export const WALK_BUDGET = 0.35;
/** An alternative is offered only when its exposure is at least this share below the fastest route's. */
export const MIN_GAIN = 0.05;

export interface BudgetOptions extends SearchOptions {
  /** Extra time allowed over the fastest route, as a share of its time (0.25 = a quarter longer). */
  budget?: number;
  /** Heaviest exposure weight tried: its route is close to the least exposure there is. */
  wMax?: number;
  /** Least exposure gain against the fastest route for a route to be offered. */
  minGain?: number;
  /** Searches spent on finding the last supported route inside the budget. */
  steps?: number;
}

/**
 * Walking routes by time and exposure (T7): the fastest route, and the supported Pareto route with the least exposure
 * whose time stays within (1 + budget) x the fastest time, plus one supported route between the two when it is clearly
 * different from both. Sorted fastest first, so the last one is the cleanest. Only the fastest comes back when no route
 * inside the budget breathes at least minGain less.
 *
 * Why not pareto() with a fixed weight: a fixed weight fixes the exchange rate between time and exposure, so on one trip
 * it stops at the first lane and on another it doubles the walk. The budget says what the walker is asked to give (time)
 * and the search spends it where it buys the most. The last supported route inside the budget is found by weight
 * bisection between the fastest route and the one at wMax (each step lands on a supported route between the two).
 */
export function withinBudget(g: WalkGraph, s: number, t: number, o: BudgetOptions): RouteResult[] {
  const budget = o.budget ?? WALK_BUDGET, wMax = o.wMax ?? 64, minGain = o.minGain ?? MIN_GAIN, steps = o.steps ?? 10;
  const fast = route(g, s, t, 0, o);
  if (!fast) return [];
  const limit = fast.timeS * (1 + budget);
  const key = (r: RouteResult) => r.edges.join(',');
  /** The supported route between a and b at their own exchange rate, or null when there is none. */
  const between = (a: RouteResult, b: RouteResult): RouteResult | null => {
    if (!(a.exposure > b.exposure && b.timeS > a.timeS)) return null;
    const ws = (b.timeS - a.timeS) / (a.exposure - b.exposure);
    const r = route(g, s, t, ws, o)!;
    return r.timeS + ws * r.exposure < a.timeS + ws * a.exposure - 1e-9 ? r : null;
  };
  let hi = route(g, s, t, wMax, o)!;
  let clean = fast;
  if (hi.timeS <= limit) clean = hi;
  else {
    for (let k = 0; k < steps; k++) {
      const r = between(clean, hi);
      if (!r) break;
      if (r.timeS <= limit) clean = r; else hi = r;
    }
  }
  if (key(clean) === key(fast) || !(clean.exposure <= fast.exposure * (1 - minGain))) return [fast];
  const mid = between(fast, clean);
  // one alternative, only when it is a real third choice: clearly less exposure than the fastest, clearly more than the
  // cleanest, and at least a minute quicker than the cleanest
  const useMid = mid && mid.exposure <= fast.exposure * (1 - minGain) && mid.exposure >= clean.exposure * (1 + minGain) && clean.timeS - mid.timeS >= 60;
  return useMid ? [fast, mid, clean] : [fast, clean];
}

/** Grid index of node positions (about 110 m cells) for snapping a point to its nearest node. */
export class NodeIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly g: WalkGraph;
  private static readonly CELL = 0.001;

  constructor(g: WalkGraph) {
    this.g = g;
    for (let u = 0; u < g.n; u++) {
      const k = this.key(Math.floor(g.nodeLat(u) / NodeIndex.CELL), Math.floor(g.nodeLon(u) / NodeIndex.CELL));
      const list = this.cells.get(k);
      if (list) list.push(u); else this.cells.set(k, [u]);
    }
  }

  private key(i: number, j: number): number { return i * 1_000_003 + j; }

  /** Nearest node within maxM metres (searching outward ring by ring) that passes keep, or -1. */
  nearest(lat: number, lon: number, maxM = 500, keep?: (u: number) => boolean): number {
    const ci = Math.floor(lat / NodeIndex.CELL), cj = Math.floor(lon / NodeIndex.CELL);
    let best = -1, bestD = Infinity;
    const rings = Math.ceil(maxM / 100) + 1;
    for (let r = 0; r <= rings; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        for (const u of this.cells.get(this.key(ci + di, cj + dj)) ?? []) {
          if (keep && !keep(u)) continue;
          const d = distM(lat, lon, this.g.nodeLat(u), this.g.nodeLon(u));
          if (d < bestD) { bestD = d; best = u; }
        }
      }
      // a node found in ring r can only be beaten by one within the next ring
      if (best >= 0 && bestD < r * 100) break;
    }
    return bestD <= maxM ? best : -1;
  }
}
