/**
 * X-W93: does leaving courses and adult education out of the school breathing zone change motor routes? For a region,
 * the demo trip and 200 seeded trips at 06.45 local time are routed with the published school points and with the points
 * that scripts/field/facility-clean.ts courseReason keeps; reports whether the edges, length and time change, and the
 * zone's own cost (zoned route against the route without any zone) for the demo trip. Inputs as scripts/field/motor-bench.mts.
 *
 *   pnpm exec tsx scripts/field/zona-kursus-rute.mts --name kota_bogor --demo -6.56830,106.77044~-6.54559,106.78964 [--field D:/breeva-ml-data/field]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WalkGraph } from '../../src/lib/route/walkGraph.js';
import { NodeIndex, route } from '../../src/lib/route/router.js';
import { motorNode, motorRoute } from '../../src/lib/route/cost.js';
import { HargaIndex } from '../../src/lib/field/harga.js';
import { motorRouteAt, schoolEdges, type SchoolFile } from '../../src/lib/route/schoolZone.js';
import { decodeCell } from './cells.js';
import { courseReason } from './facility-clean.js';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'kota_bogor');
const root = arg('field', 'D:/breeva-ml-data/field');
const [[la, lo], [lb, lob]] = arg('demo', '').split('~').map((p) => p.split(',').map(Number));
const man = JSON.parse(readFileSync(join(root, 'v', name, 'manifest.json'), 'utf8')) as { run: string; cells: number[]; geometry: string };
const g = new WalkGraph(new Uint8Array(readFileSync(join(root, 'graphs', man.geometry, `${name}.bin`))));
const harga = new HargaIndex(new Uint8Array(readFileSync(join(root, 'harga', man.geometry, 'client', `${name}.bin`))));
const cells = new Map<number, ReturnType<typeof decodeCell>>();
for (const c of man.cells) cells.set(c, decodeCell(new Uint8Array(readFileSync(join(root, 'v', name, man.run, `${c}.bin`)))));
const no2 = new Float64Array(g.m).fill(Number.NaN), hh = new Float64Array(g.m).fill(Number.NaN);
for (let e = 0; e < g.m; e++) {
  const r = g.road(e);
  if (!r) continue;
  const v = cells.get(r.c)?.[r.i];
  if (v) no2[e] = v.no2;
  const h = harga.value(r.c, r.i);
  if (h != null) hh[e] = h;
}
const inp = { no2, harga: hh };
const sf = JSON.parse(readFileSync(join(root, 'graphs', man.geometry, `${name}_schools.json`), 'utf8')) as SchoolFile & { names: string[]; kinds: string[] };
const keep = sf.points.map((_, k) => !courseReason(sf.names?.[k], sf.kinds?.[k] ?? 'school'));
const sfNew: SchoolFile = { ...sf, points: sf.points.filter((_, k) => keep[k]) };
const zOld = { file: sf, edgeSchool: schoolEdges(g, sf.points, sf.radius_m) };
const zNew = { file: sfNew, edgeSchool: schoolEdges(g, sfNew.points, sf.radius_m) };
const at = Date.UTC(2026, 10, 23, 6 - sf.tz, 45); // Monday 23 Nov 2026, 06.45 local
const idx = new NodeIndex(g);
const snap = (lat: number, lon: number) => idx.nearest(lat, lon, 500, (u) => motorNode(g, u));

const pair = (s: number, t: number) => {
  const a = motorRouteAt(route, g, 'motor', s, t, inp, zOld, at), b = motorRouteAt(route, g, 'motor', s, t, inp, zNew, at);
  const free = motorRoute(route, g, 'motor', s, t, inp);
  return { a, b, free, same: !!a && !!b && a.route.edges.join(',') === b.route.edges.join(',') };
};
const s0 = snap(la, lo), t0 = snap(lb, lob);
const d = pair(s0, t0);
const zoneCost = (r: typeof d.a) => r && d.free ? { tambah_menit: Math.round((r.route.timeS - d.free.route.timeS) / 60), tambah_m: Math.round(r.route.lengthM - d.free.route.lengthM) } : null;

let a = 20261123 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let trips = 0, changed = 0, none = 0;
while (trips < 200) {
  const s = Math.floor(rnd() * g.n), t = Math.floor(rnd() * g.n);
  const dd = Math.hypot((g.nodeLon(t) - g.nodeLon(s)) * 110000, (g.nodeLat(t) - g.nodeLat(s)) * 110574);
  if (dd < 1500 || dd > 6000 || !motorNode(g, s) || !motorNode(g, t)) continue;
  trips++;
  const p = pair(s, t);
  if (!p.a || !p.b) none++;
  else if (!p.same) changed++;
}
console.log(JSON.stringify({
  name, run_lokal: man.run, titik_lama: sf.points.length, titik_baru: sfNew.points.length,
  peragaan: {
    sama: d.same, lama: d.a && { km: +(d.a.route.lengthM / 1000).toFixed(2), menit: Math.round(d.a.route.timeS / 60), zona: d.a.school, biaya_zona: zoneCost(d.a) },
    baru: d.b && { km: +(d.b.route.lengthM / 1000).toFixed(2), menit: Math.round(d.b.route.timeS / 60), zona: d.b.school, biaya_zona: zoneCost(d.b) },
  },
  acak_200: { berubah: changed, tanpa_rute: none },
}));
