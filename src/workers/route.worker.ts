/// <reference lib="webworker" />
/**
 * Routing off the main thread. Messages:
 *   { id, type: 'init', base, region: { name, geometry } }  loads graph + field (Cache API, so it also works offline)
 *   { id, type: 'route', from: {lat, lng}, to: {lat, lng}, mode?, departLocal? } Pareto walking routes (exposure = NO2
 *     of the field roads), or motor routes with the zona napas and, when the departure (local "HH:MM", default now)
 *     falls in school hours, the school zone; a departure later than now uses the exhaust forecast of that hour
 *     (BXF1, src/lib/field/forecast.ts) and a departure now also reports the next hours of the cleanest route, in a
 *     second reply { id, type: 'soon', ok: true, soon } sent after the routes (the route reply says soonPending)
 * Replies { id, ok: true, ... } or { id, ok: false, error }.
 */
import { WalkGraph } from '../lib/route/walkGraph';
import { NodeIndex, pareto, route, type RouteResult } from '../lib/route/router';
import { motorNode } from '../lib/route/cost';
import { localTimeToMs, motorRouteAt, schoolEdges, type SchoolFile, type SchoolZone } from '../lib/route/schoolZone';
import { HargaIndex } from '../lib/field/harga';
import { cachedBytes } from '../lib/route/assets';
import { loadRegionFiles } from '../lib/route/regionFiles';
import { decodeCell } from '../lib/field/cells';
import { decodeExhaust, pickForecast, SOON_HOURS, type ForecastEntry } from '../lib/field/forecast';
import { edgeExhaust, meanAlong, no2AtHour, type SoonHour } from '../lib/route/departForecast';
import { fieldMedian } from '../lib/route/fieldMedian';

const SPEED = 1.3; // m/s
let graph: WalkGraph | null = null;
let index: NodeIndex | null = null;
let no2: Float64Array | null = null;
let pm25: Float64Array | null = null;
let exhaust: Float64Array | null = null;
let harga: Float64Array | null = null;
let run = '';
let schoolFile: SchoolFile | null = null;
let schools: SchoolZone | null = null;
let fieldRoot = '';
let forecasts: ForecastEntry[] = [];
let runLocalHour = -1;
const forecastEdges = new Map<string, Promise<Float64Array>>();
/** NO2 of each forecast hour, kept with the hour's exhaust so its median is also computed once (F3-21). */
const forecastNo2 = new Map<string, { x: Float64Array; no2: Float64Array }>();

async function init(base: string, region: { name: string; geometry: string }) {
  // every file requested at once (F1-53); the Cache API keeps them for offline use
  const files = await loadRegionFiles(base, region, (url, o) => cachedBytes(url, o));
  const g = new WalkGraph(files.graph);
  const manifest = files.manifest;
  const cells = new Map<number, ReturnType<typeof decodeCell>>();
  for (const [c, b] of files.cells) cells.set(c, decodeCell(b));
  let hi: HargaIndex | null = null;
  try { hi = files.harga ? new HargaIndex(files.harga) : null; } catch { hi = null; }
  const n = new Float64Array(g.m).fill(Number.NaN), p = new Float64Array(g.m).fill(Number.NaN), h = new Float64Array(g.m).fill(Number.NaN);
  const x = new Float64Array(g.m).fill(Number.NaN);
  for (let e = 0; e < g.m; e++) {
    const r = g.road(e);
    if (!r) continue;
    const v = cells.get(r.c)?.[r.i];
    if (v) { n[e] = v.no2; p[e] = v.pm25; x[e] = v.no2_delta; }
    const hv = hi?.value(r.c, r.i);
    if (hv != null) h[e] = hv;
  }
  let sf: SchoolFile | null = null;
  try { sf = files.schools ? JSON.parse(new TextDecoder().decode(files.schools)) as SchoolFile : null; } catch { sf = null; }
  graph = g; index = new NodeIndex(g); no2 = n; pm25 = p; exhaust = x; harga = hi ? h : null; run = manifest.run;
  fieldMedian(n); // computed while loading, so the first route does not pay for it
  schoolFile = sf; schools = null;
  fieldRoot = `${base}/v/${region.name}/${manifest.run}`;
  forecasts = Array.isArray(manifest.forecast_runs) ? manifest.forecast_runs : [];
  runLocalHour = manifest.valid_hour_local ?? -1;
  forecastEdges.clear();
  forecastNo2.clear();
  return { nodes: g.n, edges: g.m, run, harga: !!hi, schools: sf?.points.length ?? 0, forecasts: forecasts.length };
}


/** School of every edge, computed on the first motor route (a few hundred ms) so walking stays fast to start. */
function schoolZone(g: WalkGraph): SchoolZone | null {
  if (!schoolFile) return null;
  if (!schools) schools = { file: schoolFile, edgeSchool: schoolEdges(g, schoolFile.points, schoolFile.radius_m) };
  return schools;
}

/** Exhaust per edge of one forecast hour, loaded once per run (Cache API, so it also works offline). */
function exhaustOf(entry: ForecastEntry): Promise<Float64Array> {
  let p = forecastEdges.get(entry.key);
  if (!p) {
    const g = graph!;
    p = cachedBytes(`${fieldRoot}/${entry.key}`, { cacheFirst: true }).then((b) => edgeExhaust(g, decodeExhaust(b)));
    p.catch(() => forecastEdges.delete(entry.key));
    forecastEdges.set(entry.key, p);
  }
  return p;
}

function routeBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walk' | 'motor', at: number,
  field?: { no2: Float64Array; exhaust: Float64Array; hour: number }) {
  if (!graph || !index || !no2 || !pm25) throw new Error('router not initialised');
  const g = graph;
  const keep = mode === 'motor' ? (u: number) => motorNode(g, u) : undefined;
  const s = index.nearest(from.lat, from.lng, 500, keep), t = index.nearest(to.lat, to.lng, 500, keep);
  if (s < 0 || t < 0) throw new Error('titik di luar jaringan jalan wilayah ini');
  const nArr = field?.no2 ?? no2, pArr = pm25, hArr = harga, xArr = field?.exhaust ?? exhaust;
  let routes: Array<RouteResult & { kind?: 'dua-angka' | 'darurat'; school?: 'off' | 'kept' | 'lifted-near-ends';
    schoolCost?: { extraM: number; extraS: number; changed: boolean } }>;
  if (mode === 'motor') {
    const inp = { no2: nArr, harga: hArr ?? undefined };
    const zone = schoolZone(g);
    const two = motorRouteAt(route, g, 'motor', s, t, inp, zone, at);
    const emer = motorRouteAt(route, g, 'motor', s, t, inp, zone, at, true);
    if (!two || !emer) throw new Error('tidak ada rute kendaraan yang menghormati zona napas');
    // while the zone is on, the same two searches without it say what the zone costs (F3-09)
    const costOf = (withZone: RouteResult, emergency: boolean) => {
      const free = motorRouteAt(route, g, 'motor', s, t, inp, null, at, emergency);
      if (!free) return undefined;
      return { extraM: withZone.lengthM - free.route.lengthM, extraS: withZone.timeS - free.route.timeS,
        changed: withZone.edges.join(',') !== free.route.edges.join(',') };
    };
    const zoneOn = two.school !== 'off';
    const twoCost = zoneOn ? costOf(two.route, false) : undefined;
    // fastest (emergency) first, like the walking list; the same route twice is shown once
    routes = emer.route.edges.join(',') === two.route.edges.join(',')
      ? [{ ...two.route, kind: 'dua-angka', school: two.school, schoolCost: twoCost }]
      : [{ ...emer.route, kind: 'darurat', school: emer.school, schoolCost: emer.school !== 'off' ? costOf(emer.route, true) : undefined },
        { ...two.route, kind: 'dua-angka', school: two.school, schoolCost: twoCost }];
  } else {
    const medN = fieldMedian(nArr); // once per field array, not per request (F3-20)
    routes = pareto(g, s, t, { speed: SPEED, exposureOf: (e) => (Number.isFinite(nArr[e]) ? nArr[e] / medN : 1) });
  }
  const raw = routes;
  const out = routes.map((r) => {
    let pmDose = 0, no2Dose = 0, hDose = 0, xDose = 0, tSum = 0;
    const coords: Array<[number, number]> = [];
    r.edges.forEach((e, k) => {
      const tS = (g.lenDm[e] / 10) * (r.timeS / Math.max(1, r.lengthM)); // time share of the edge (route's own speeds)
      tSum += tS;
      pmDose += (Number.isFinite(pArr[e]) ? pArr[e] : 0) * tS;
      no2Dose += (Number.isFinite(nArr[e]) ? nArr[e] : 0) * tS;
      xDose += (xArr && Number.isFinite(xArr[e]) ? xArr[e] : 0) * tS;
      hDose += (hArr && Number.isFinite(hArr[e]) ? hArr[e] : 1) * tS;
      const pts = g.edgeCoords(e, r.nodes[k]);
      coords.push(...(k === 0 ? pts : pts.slice(1)));
    });
    // mean concentration along the route (ug/m3), the honest number to compare routes by
    const o = { lengthM: Math.round(r.lengthM), timeS: Math.round(r.timeS), pm25Mean: pmDose / tSum, no2Mean: no2Dose / tSum, exhMean: xDose / tSum, coords, w: r.w,
      forecastHour: field ? field.hour : null };
    return mode === 'motor' ? { ...o, kind: r.kind, hargaMean: hDose / tSum, school: r.school, schoolCost: r.schoolCost } : o;
  });
  return { routes: out, raw };
}

/** Route request: the field of the departure hour, the routes, and for a departure now the next hours of the last route. */
async function routeAt(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'walk' | 'motor', departLocal: string | null | undefined) {
  const at = schoolFile ? localTimeToMs(departLocal, schoolFile.tz, Date.now()) : Date.now();
  const entry = pickForecast(forecasts, departLocal, runLocalHour);
  let field: { no2: Float64Array; exhaust: Float64Array; hour: number } | undefined;
  if (entry && no2 && exhaust) {
    try {
      const x = await exhaustOf(entry);
      let f = forecastNo2.get(entry.key);
      if (!f || f.x !== x) { f = { x, no2: no2AtHour(no2, exhaust, x) }; forecastNo2.set(entry.key, f); }
      field = { no2: f.no2, exhaust: x, hour: entry.local_hour };
    } catch { field = undefined; } // forecast file unavailable: the run's own hour, labelled as such by forecastHour null
  }
  const { routes, raw } = routeBetween(from, to, mode, at, field);
  // a departure now: the next hours of the cleanest route are worked out after the routes are sent (F3-18), because
  // loading the forecast files is the slow part of a first route on a slow phone
  const soonHours = forecasts.filter((f) => f.ahead <= SOON_HOURS);
  let soonPlan: (() => Promise<SoonHour[]>) | null = null;
  if (!field && routes.length && graph && soonHours.length) {
    const last = raw[raw.length - 1], g = graph;
    soonPlan = async () => {
      const soon: SoonHour[] = [];
      for (const e of soonHours) {
        try { soon.push({ local_hour: e.local_hour, ahead: e.ahead, exhMean: meanAlong(g, last.edges, last.timeS, last.lengthM, await exhaustOf(e)) }); } catch { /* skip that hour */ }
      }
      return soon;
    };
  }
  return { routes, soonPlan };
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, type } = ev.data ?? {};
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(ev.data.base, ev.data.region)) });
    else if (type === 'route') {
      const t0 = performance.now();
      const { routes, soonPlan } = await routeAt(ev.data.from, ev.data.to, ev.data.mode === 'motor' ? 'motor' : 'walk', ev.data.departLocal);
      self.postMessage({ id, ok: true, routes, ms: performance.now() - t0, run, soonPending: !!soonPlan });
      if (soonPlan) {
        // second reply with the same id: the leave-later hint for the last route
        const soon = await soonPlan().catch(() => [] as SoonHour[]);
        self.postMessage({ id, type: 'soon', ok: true, soon });
      }
    } else throw new Error(`unknown message ${type}`);
  } catch (e) {
    self.postMessage({ id, ok: false, error: (e as Error).message });
  }
};
