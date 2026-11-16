/// <reference lib="webworker" />
/**
 * Routing off the main thread. Messages:
 *   { id, type: 'init', base, region: { name, geometry } }  loads graph + field (Cache API, so it also works offline)
 *   { id, type: 'route', from: {lat, lng}, to: {lat, lng} } Pareto walking routes, exposure = NO2 of the field roads
 * Replies { id, ok: true, ... } or { id, ok: false, error }.
 */
import { WalkGraph } from '../lib/route/walkGraph';
import { NodeIndex, pareto } from '../lib/route/router';
import { cachedBytes } from '../lib/route/assets';
import { decodeCell } from '../lib/field/cells';

const SPEED = 1.3; // m/s
let graph: WalkGraph | null = null;
let index: NodeIndex | null = null;
let no2: Float64Array | null = null;
let pm25: Float64Array | null = null;
let run = '';

async function init(base: string, region: { name: string; geometry: string }) {
  const g = new WalkGraph(await cachedBytes(`${base}/graphs/${region.geometry}/${region.name}.bin`, { cacheFirst: true }));
  const manifest = JSON.parse(new TextDecoder().decode(await cachedBytes(`${base}/v/${region.name}/manifest.json`, { cacheFirst: false }))) as { run: string; cells: number[] };
  const cells = new Map<number, ReturnType<typeof decodeCell>>();
  await Promise.all(manifest.cells.map(async (c) => {
    cells.set(c, decodeCell(await cachedBytes(`${base}/v/${region.name}/${manifest.run}/${c}.bin`, { cacheFirst: true })));
  }));
  const n = new Float64Array(g.m).fill(Number.NaN), p = new Float64Array(g.m).fill(Number.NaN);
  for (let e = 0; e < g.m; e++) {
    const r = g.road(e);
    const v = r ? cells.get(r.c)?.[r.i] : undefined;
    if (v) { n[e] = v.no2; p[e] = v.pm25; }
  }
  graph = g; index = new NodeIndex(g); no2 = n; pm25 = p; run = manifest.run;
  return { nodes: g.n, edges: g.m, run };
}

function median(a: Float64Array): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

function routeBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  if (!graph || !index || !no2 || !pm25) throw new Error('router not initialised');
  const g = graph;
  const s = index.nearest(from.lat, from.lng), t = index.nearest(to.lat, to.lng);
  if (s < 0 || t < 0) throw new Error('titik di luar jaringan jalan wilayah ini');
  const medN = median(no2);
  const nArr = no2, pArr = pm25;
  const routes = pareto(g, s, t, { speed: SPEED, exposureOf: (e) => (Number.isFinite(nArr[e]) ? nArr[e] / medN : 1) });
  return routes.map((r) => {
    let pmDose = 0, no2Dose = 0;
    const coords: Array<[number, number]> = [];
    r.edges.forEach((e, k) => {
      const tS = g.lenDm[e] / 10 / SPEED;
      pmDose += (Number.isFinite(pArr[e]) ? pArr[e] : 0) * tS;
      no2Dose += (Number.isFinite(nArr[e]) ? nArr[e] : 0) * tS;
      const pts = g.edgeCoords(e, r.nodes[k]);
      coords.push(...(k === 0 ? pts : pts.slice(1)));
    });
    // mean concentration along the route (ug/m3), the honest number to compare routes by
    return { lengthM: Math.round(r.lengthM), timeS: Math.round(r.timeS), pm25Mean: pmDose / r.timeS, no2Mean: no2Dose / r.timeS, coords, w: r.w };
  });
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, type } = ev.data ?? {};
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(ev.data.base, ev.data.region)) });
    else if (type === 'route') {
      const t0 = performance.now();
      const routes = routeBetween(ev.data.from, ev.data.to);
      self.postMessage({ id, ok: true, routes, ms: performance.now() - t0, run });
    } else throw new Error(`unknown message ${type}`);
  } catch (e) {
    self.postMessage({ id, ok: false, error: (e as Error).message });
  }
};
