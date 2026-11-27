/**
 * T9 (Tristan, 27 Nov: "why can't it make a route elsewhere? compute it anyway and say what it lacks"): a walking graph
 * built on the phone from the national road tiles (z14, the same tiles the national exhaust is computed from), so a
 * walking route can be found anywhere in Indonesia, with the exhaust of each road as its exposure. Pure, tested.
 *
 * The tiles hold OpenStreetMap roads (class only) cut by tippecanoe: every z14 tile repeats the roads of its buffer, and
 * tippecanoe simplifies at z14 too (it may drop a junction vertex on a straight road). So the graph
 *  - joins vertices within 1.5 m into one node (the same OSM node lands on slightly different points in two tiles),
 *  - joins a road end that stops within 4 m of another road to it (a T-junction whose shared vertex was dropped),
 *  - splits two roads where they cross without a shared vertex (a cross junction whose vertex was dropped), except where
 *    a motorway or trunk road is involved (those cross on bridges more often than at grade),
 *  - keeps one copy of segments repeated by neighbouring tiles,
 *  - leaves out motorways (no walking).
 */

export interface UbinRuas { coords: ArrayLike<number>; offs: ArrayLike<number>; nox: ArrayLike<number>; k: ArrayLike<number> }

export interface GrafNasional {
  n: number; m: number;
  off: Uint32Array; target: Uint32Array; lenDm: Uint16Array;
  /** vehicle exhaust (traffic NOx, ug/m3) and road class code of each directed edge */
  nox: Float64Array; kelas: Uint8Array;
  lat: Float64Array; lon: Float64Array;
  /** connected component of each node and the size of each component */
  komponen: Int32Array; ukuranKomponen: number[];
  nodeLat(u: number): number; nodeLon(u: number): number;
}

export interface OpsiGraf {
  /** road class codes left out (1 = motorway) */
  kecuali?: ReadonlySet<number>;
  /** a road end this close to another road is joined to it, metres */
  sambungM?: number;
  /** split roads where they cross without a shared vertex */
  silang?: boolean;
}

const SATU_M = 1.5;
const SEL_SIMPUL = 2e-5; // ~2.2 m
const SEL_RUAS = 4e-4; // ~44 m
const RAD = Math.PI / 180;

function meter(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD), y = (lat2 - lat1) * RAD;
  return 6371008.8 * Math.hypot(x, y);
}

export function bangunGraf(ubin: readonly UbinRuas[], o: OpsiGraf = {}): GrafNasional {
  const kecuali = o.kecuali ?? new Set([1]);
  const sambungM = o.sambungM ?? 4;
  const silang = o.silang ?? true;
  const lat: number[] = [], lon: number[] = [];
  const selSimpul = new Map<number, number[]>();
  const kunciSimpul = (ci: number, cj: number) => (ci + 1_000_000) * 10_000_000 + cj;
  /** the node at this point: an existing one within 1.5 m, else a new one */
  const simpul = (la: number, lo: number): number => {
    const ci = Math.floor(la / SEL_SIMPUL), cj = Math.floor(lo / SEL_SIMPUL);
    let best = -1, bestD = SATU_M;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const u of selSimpul.get(kunciSimpul(ci + di, cj + dj)) ?? []) {
        const d = meter(la, lo, lat[u], lon[u]);
        if (d <= bestD) { bestD = d; best = u; }
      }
    }
    if (best >= 0) return best;
    const u = lat.length;
    lat.push(la); lon.push(lo);
    const key = kunciSimpul(ci, cj);
    const l = selSimpul.get(key); if (l) l.push(u); else selSimpul.set(key, [u]);
    return u;
  };

  // segments between consecutive vertices of every road
  const sa: number[] = [], sb: number[] = [], sk: number[] = [], sx: number[] = [], sg: number[] = [];
  const ujung: Array<[number, number]> = []; // [node, road]
  let garis = 0;
  for (const t of ubin) {
    for (let r = 0; r + 1 < t.offs.length; r++, garis++) {
      const kelas = Number(t.k[r]);
      if (kecuali.has(kelas)) continue;
      const a0 = Number(t.offs[r]), b0 = Number(t.offs[r + 1]);
      if (b0 - a0 < 2) continue;
      let prev = -1;
      for (let v = a0; v < b0; v++) {
        const u = simpul(Number(t.coords[2 * v + 1]), Number(t.coords[2 * v]));
        if (prev >= 0 && u !== prev) { sa.push(prev); sb.push(u); sk.push(kelas); sx.push(Number(t.nox[r])); sg.push(garis); }
        if (v === a0) ujung.push([u, garis]);
        prev = u;
      }
      ujung.push([prev, garis]);
    }
  }

  // grid of segments for the junction repairs
  const selRuas = new Map<number, number[]>();
  const kunciRuas = (ci: number, cj: number) => (ci + 100_000) * 1_000_000 + cj;
  const masuk = (s: number) => {
    const la0 = Math.min(lat[sa[s]], lat[sb[s]]), la1 = Math.max(lat[sa[s]], lat[sb[s]]);
    const lo0 = Math.min(lon[sa[s]], lon[sb[s]]), lo1 = Math.max(lon[sa[s]], lon[sb[s]]);
    for (let ci = Math.floor(la0 / SEL_RUAS); ci <= Math.floor(la1 / SEL_RUAS); ci++) {
      for (let cj = Math.floor(lo0 / SEL_RUAS); cj <= Math.floor(lo1 / SEL_RUAS); cj++) {
        const key = kunciRuas(ci, cj);
        const l = selRuas.get(key); if (l) l.push(s); else selRuas.set(key, [s]);
      }
    }
  };
  const nSeg = sa.length;
  for (let s = 0; s < nSeg; s++) masuk(s);
  /** splits per segment: [position along it 0..1, node] */
  const potong = new Map<number, Array<[number, number]>>();
  const tambahPotong = (s: number, t: number, u: number) => { const l = potong.get(s); if (l) l.push([t, u]); else potong.set(s, [[t, u]]); };
  const derajat = new Map<number, number>();
  for (let s = 0; s < nSeg; s++) { derajat.set(sa[s], (derajat.get(sa[s]) ?? 0) + 1); derajat.set(sb[s], (derajat.get(sb[s]) ?? 0) + 1); }

  // 1. a road end near another road (T-junction)
  const sambungan: Array<[number, number, number, number]> = []; // [a, b, kelas, nox]
  const ujungUnik = new Map<number, number>();
  for (const [u, g] of ujung) if (!ujungUnik.has(u)) ujungUnik.set(u, g);
  for (const [u, g] of ujungUnik) {
    if ((derajat.get(u) ?? 0) !== 1) continue;
    const ci = Math.floor(lat[u] / SEL_RUAS), cj = Math.floor(lon[u] / SEL_RUAS);
    const cosL = Math.cos(lat[u] * RAD);
    let best = -1, bestD = sambungM, bestT = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const s of selRuas.get(kunciRuas(ci + di, cj + dj)) ?? []) {
        if (sa[s] === u || sb[s] === u || sg[s] === g) continue;
        // projection in a local metric frame
        const ax = lon[sa[s]] * cosL, ay = lat[sa[s]], bx = lon[sb[s]] * cosL, by = lat[sb[s]], px = lon[u] * cosL, py = lat[u];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (!(l2 > 0)) continue;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        const d = meter(py, px / cosL, ay + t * dy, (ax + t * dx) / cosL);
        if (d < bestD) { bestD = d; best = s; bestT = t; }
      }
    }
    if (best < 0) continue;
    const la = lat[sa[best]] + bestT * (lat[sb[best]] - lat[sa[best]]), lo = lon[sa[best]] + bestT * (lon[sb[best]] - lon[sa[best]]);
    const p = simpul(la, lo);
    if (p !== sa[best] && p !== sb[best]) tambahPotong(best, bestT, p);
    if (p !== u) sambungan.push([u, p, sk[best], sx[best]]);
  }

  // 2. two roads crossing without a shared vertex
  if (silang) {
    const dilihat = new Set<string>();
    for (const l of selRuas.values()) {
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const s1 = l[i], s2 = l[j];
        if (sg[s1] === sg[s2] || sk[s1] <= 2 || sk[s2] <= 2) continue;
        if (sa[s1] === sa[s2] || sa[s1] === sb[s2] || sb[s1] === sa[s2] || sb[s1] === sb[s2]) continue;
        const key = s1 < s2 ? `${s1},${s2}` : `${s2},${s1}`;
        if (dilihat.has(key)) continue;
        dilihat.add(key);
        const x1 = lon[sa[s1]], y1 = lat[sa[s1]], x2 = lon[sb[s1]], y2 = lat[sb[s1]];
        const x3 = lon[sa[s2]], y3 = lat[sa[s2]], x4 = lon[sb[s2]], y4 = lat[sb[s2]];
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) < 1e-18) continue;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        const v = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
        if (!(t > 0.001 && t < 0.999 && v > 0.001 && v < 0.999)) continue;
        const p = simpul(y1 + t * (y2 - y1), x1 + t * (x2 - x1));
        if (p !== sa[s1] && p !== sb[s1]) tambahPotong(s1, t, p);
        if (p !== sa[s2] && p !== sb[s2]) tambahPotong(s2, v, p);
      }
    }
  }

  // segments after the splits, one copy each
  const tepi = new Map<string, [number, number, number, number]>();
  const tambahTepi = (a: number, b: number, k: number, x: number) => {
    if (a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!tepi.has(key)) tepi.set(key, [a, b, k, x]);
  };
  for (let s = 0; s < nSeg; s++) {
    const l = potong.get(s);
    if (!l) { tambahTepi(sa[s], sb[s], sk[s], sx[s]); continue; }
    l.sort((p, q) => p[0] - q[0]);
    let prev = sa[s];
    for (const [, u] of l) { tambahTepi(prev, u, sk[s], sx[s]); prev = u; }
    tambahTepi(prev, sb[s], sk[s], sx[s]);
  }
  for (const [a, b, k, x] of sambungan) tambahTepi(a, b, k, x);

  // directed edges in CSR order
  const n = lat.length;
  const deg = new Uint32Array(n + 1);
  for (const [a, b] of tepi.values()) { deg[a + 1]++; deg[b + 1]++; }
  for (let u = 0; u < n; u++) deg[u + 1] += deg[u];
  const m = deg[n];
  const target = new Uint32Array(m), lenDm = new Uint16Array(m), nox = new Float64Array(m), kelas = new Uint8Array(m);
  const isi = deg.slice(0, n);
  for (const [a, b, k, x] of tepi.values()) {
    const d = Math.max(1, Math.min(65535, Math.round(meter(lat[a], lon[a], lat[b], lon[b]) * 10)));
    for (const [u, v] of [[a, b], [b, a]] as const) {
      const e = isi[u]++;
      target[e] = v; lenDm[e] = d; nox[e] = x; kelas[e] = k;
    }
  }

  // connected components (union-find)
  const ind = new Int32Array(n).map((_, i) => i);
  const akar = (u: number): number => { while (ind[u] !== u) { ind[u] = ind[ind[u]]; u = ind[u]; } return u; };
  for (const [a, b] of tepi.values()) { const ra = akar(a), rb = akar(b); if (ra !== rb) ind[ra] = rb; }
  const komponen = new Int32Array(n), nomor = new Map<number, number>(), ukuranKomponen: number[] = [];
  for (let u = 0; u < n; u++) {
    const r = akar(u);
    let c = nomor.get(r);
    if (c == null) { c = ukuranKomponen.length; nomor.set(r, c); ukuranKomponen.push(0); }
    komponen[u] = c; ukuranKomponen[c]++;
  }
  const latA = Float64Array.from(lat), lonA = Float64Array.from(lon);
  return {
    n, m, off: deg, target, lenDm, nox, kelas, lat: latA, lon: lonA, komponen, ukuranKomponen,
    nodeLat: (u: number) => latA[u], nodeLon: (u: number) => lonA[u],
  };
}

/**
 * The node a point snaps to: the nearest within maxM that lies in a large piece of the network (a quarter of the
 * largest at least), so a start is not put on a stray fragment; -1 when none.
 */
export function simpulTerdekat(g: GrafNasional, la: number, lo: number, maxM = 300): number {
  const besar = Math.max(0, ...g.ukuranKomponen);
  let best = -1, bestD = maxM;
  for (let u = 0; u < g.n; u++) {
    if (g.ukuranKomponen[g.komponen[u]] < besar / 4) continue;
    const d = meter(la, lo, g.lat[u], g.lon[u]);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}
