/// <reference lib="webworker" />
/**
 * Routing off the main thread. Messages:
 *   { id, type: 'init', base, region: { name, geometry } }  loads graph + field (Cache API, so it also works offline)
 *   { id, type: 'route', from: {lat, lng}, to: {lat, lng}, mode?, departLocal? } Pareto walking routes (exposure = NO2
 *     of the field roads), or motor routes with the zona napas and, when the departure (local "HH:MM", default now)
 *     falls in school hours, the school zone
 * Replies { id, ok: true, ... } or { id, ok: false, error }.
 */
import { WalkGraph } from '../lib/route/walkGraph';
import { NodeIndex, pareto, route, type RouteResult } from '../lib/route/router';
import { motorNode } from '../lib/route/cost';
import { localTimeToMs, motorRouteAt, schoolEdges, type SchoolFile, type SchoolZone } from '../lib/route/schoolZone';
import { HargaIndex } from '../lib/field/harga';
import { cachedBytes } from '../lib/route/assets';
import { decodeCell } from '../lib/field/cells';

const SPEED = 1.3; // m/s
let graph: WalkGraph | null = null;
let index: NodeIndex | null = null;
let no2: Float64Array | null = null;
let pm25: Float64Array | null = null;
let harga: Float64Array | null = null;
let run = '';
let schoolFile: SchoolFile | null = null;
let schools: SchoolZone | null = null;

async function init(base: string, region: { name: string; geometry: string }) {
  const g = new WalkGraph(await cachedBytes(`${base}/graphs/${region.geometry}/${region.name}.bin`, { cacheFirst: true }));
  const manifest = JSON.parse(new TextDecoder().decode(await cachedBytes(`${base}/v/${region.name}/manifest.json`, { cacheFirst: false }))) as { run: string; cells: number[] };
  const cells = new Map<number, ReturnType<typeof decodeCell>>();
  await Promise.all(manifest.cells.map(async (c) => {
    cells.set(c, decodeCell(await cachedBytes(`${base}/v/${region.name}/${manifest.run}/${c}.bin`, { cacheFirst: true })));
  }));
  let hi: HargaIndex | null = null;
  try { hi = new HargaIndex(await cachedBytes(`${base}/harga/${region.geometry}/${region.name}.bin`, { cacheFirst: true })); } catch { hi = null; }
  const n = new Float64Array(g.m).fill(Number.NaN), p = new Float64Array(g.m).fill(Number.NaN), h = new Float64Array(g.m).fill(Number.NaN);
  for (let e = 0; e < g.m; e++) {
    const r = g.road(e);
    if (!r) continue;
    const v = cells.get(r.c)?.[r.i];
    if (v) { n[e] = v.no2; p[e] = v.pm25; }
    const hv = hi?.value(r.c, r.i);
    if (hv != null) h[e] = hv;
  }
  let sf: SchoolFile | null = null;
  try { sf = JSON.parse(new TextDecoder().decode(await cachedBytes(`${base}/graphs/${region.geometry}/${region.name}_schools.json`, { cacheFirst: true }))) as SchoolFile; } catch { sf = null; }
  graph = g; index = new NodeIndex(g); no2 = n; pm25 = p; harga = hi ? h : null; run = manifest.run;
  schoolFile = sf; schools = null;
  return { nodes: g.n, edges: g.m, run, harga: !!hi, schools: sf?.points.length ?? 0 };
}

function median(a: Float64Array): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

/** School of every edge, computed on the first motor route (a few hundred ms) so walking stays fast to start. */
function schoolZone(g: WalkGraph): SchoolZone | null {
  if (!schoolFile) return null;
  if (!schools) schools = { file: schoolFile, edgeSchool: schoolEdges(g, schoolFile.points, schoolFile.radius_m) };
  return schools;
}

function routeBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walk' | 'motor', at: number) {
  if (!graph || !index || !no2 || !pm25) throw new Error('router not initialised');
  const g = graph;
  const keep = mode === 'motor' ? (u: number) => motorNode(g, u) : undefined;
  const s = index.nearest(from.lat, from.lng, 500, keep), t = index.nearest(to.lat, to.lng, 500, keep);
  if (s < 0 || t < 0) throw new Error('titik di luar jaringan jalan wilayah ini');
  const nArr = no2, pArr = pm25, hArr = harga;
  let routes: Array<RouteResult & { kind?: 'dua-angka' | 'darurat'; school?: 'off' | 'kept' | 'lifted-near-ends' }>;
  if (mode === 'motor') {
    const inp = { no2: nArr, harga: hArr ?? undefined };
    const zone = schoolZone(g);
    const two = motorRouteAt(route, g, 'motor', s, t, inp, zone, at);
    const emer = motorRouteAt(route, g, 'motor', s, t, inp, zone, at, true);
    if (!two || !emer) throw new Error('tidak ada rute kendaraan yang menghormati zona napas');
    // fastest (emergency) first, like the walking list; the same route twice is shown once
    routes = emer.route.edges.join(',') === two.route.edges.join(',')
      ? [{ ...two.route, kind: 'dua-angka', school: two.school }]
      : [{ ...emer.route, kind: 'darurat', school: emer.school }, { ...two.route, kind: 'dua-angka', school: two.school }];
  } else {
    const medN = median(nArr);
    routes = pareto(g, s, t, { speed: SPEED, exposureOf: (e) => (Number.isFinite(nArr[e]) ? nArr[e] / medN : 1) });
  }
  return routes.map((r) => {
    let pmDose = 0, no2Dose = 0, hDose = 0, tSum = 0;
    const coords: Array<[number, number]> = [];
    r.edges.forEach((e, k) => {
      const tS = (g.lenDm[e] / 10) * (r.timeS / Math.max(1, r.lengthM)); // time share of the edge (route's own speeds)
      tSum += tS;
      pmDose += (Number.isFinite(pArr[e]) ? pArr[e] : 0) * tS;
      no2Dose += (Number.isFinite(nArr[e]) ? nArr[e] : 0) * tS;
      hDose += (hArr && Number.isFinite(hArr[e]) ? hArr[e] : 1) * tS;
      const pts = g.edgeCoords(e, r.nodes[k]);
      coords.push(...(k === 0 ? pts : pts.slice(1)));
    });
    // mean concentration along the route (ug/m3), the honest number to compare routes by
    const out = { lengthM: Math.round(r.lengthM), timeS: Math.round(r.timeS), pm25Mean: pmDose / tSum, no2Mean: no2Dose / tSum, coords, w: r.w };
    return mode === 'motor' ? { ...out, kind: r.kind, hargaMean: hDose / tSum, school: r.school } : out;
  });
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, type } = ev.data ?? {};
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(ev.data.base, ev.data.region)) });
    else if (type === 'route') {
      const t0 = performance.now();
      const at = schoolFile ? localTimeToMs(ev.data.departLocal, schoolFile.tz, Date.now()) : Date.now();
      const routes = routeBetween(ev.data.from, ev.data.to, ev.data.mode === 'motor' ? 'motor' : 'walk', at);
      self.postMessage({ id, ok: true, routes, ms: performance.now() - t0, run });
    } else throw new Error(`unknown message ${type}`);
  } catch (e) {
    self.postMessage({ id, ok: false, error: (e as Error).message });
  }
};
