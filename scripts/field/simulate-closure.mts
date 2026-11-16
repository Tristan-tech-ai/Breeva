/**
 * "Tutup jalan depan sekolah" for every school of a region's priority list (task F4-02, DECISIONS 16 Nov 22.20).
 * Reference conditions, the same for every school so they can be compared: local hour 07 with its traffic curve,
 * wind 1.5 m/s, the engine's stability class for that hour. For each school: the road at the gate (nearest pack
 * road within 60 m; only minor roads, tertiary and below, are closed), the motor detour around it, the exhaust at the
 * gate before and after (src/lib/policy/closure.ts), and the rise along the detour weighted by harga hirup.
 *
 *   pnpm exec tsx scripts/field/simulate-closure.mts --name badung_denpasar [--root D:/breeva-ml-data/field] [--out public/data/simulasi]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RoadPack } from './pack.js';
import { exhaustSources, roadRow } from './engine.js';
import { HOURLY_TRAFFIC } from '../../api/vayu/road-aqi.js';
import { pasquillClass } from '../../api/vayu/_caline4.js';
import { WalkGraph } from '../../src/lib/route/walkGraph.js';
import { route } from '../../src/lib/route/router.js';
import { motorAllowedClass, motorSpeed } from '../../src/lib/route/cost.js';
import { HargaIndex } from '../../src/lib/field/harga.js';
import { closureEffect, closureText, imposedOnDetour, unitContributions } from '../../src/lib/policy/closure.js';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'badung_denpasar');
const root = arg('root', 'D:/breeva-ml-data/field');
const outDir = arg('out', 'public/data/simulasi');
const HOUR = 7, WIND = 1.5, GATE_M = 60;
const CLOSABLE = new Set(['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);

const pack = new RoadPack(new Uint8Array(readFileSync(join(root, 'packs', '2026-11', `${name}.bin`))));
const g = new WalkGraph(new Uint8Array(readFileSync(join(root, 'graphs', '2026-11', `${name}.bin`))));
const harga = new HargaIndex(new Uint8Array(readFileSync(join(root, 'harga', '2026-11', 'client', `${name}.bin`))));
const list = JSON.parse(readFileSync(join('public/data/prioritas', `${name}.json`), 'utf8')) as { fasilitas: Array<{ id: string; nama: string; kelas: string; lat: number; lon: number }> };

const rows = Array.from({ length: pack.n }, (_, k) => roadRow(pack, k));
const sources = exhaustSources(rows, (k) => pack.coords(k), HOURLY_TRAFFIC[HOUR] ?? 1);
const met = { wind: WIND, stability: pasquillClass(WIND, HOUR, 0.5) };

// pack road k <-> (cell, index in cell) as in the value cells; graph edges -> pack road
const cellOf = pack.col<Uint16Array>('c');
const idxInCell = new Uint32Array(pack.n);
{ const seen = new Map<number, number>(); for (let k = 0; k < pack.n; k++) { const c = cellOf[k]; const i = seen.get(c) ?? 0; idxInCell[k] = i; seen.set(c, i + 1); } }
const keyK = new Map<string, number>();
for (let k = 0; k < pack.n; k++) keyK.set(`${cellOf[k]}:${idxInCell[k]}`, k);
const edgeRoad = new Int32Array(g.m).fill(-1);
const edgesOfRoad = new Map<number, number[]>();
for (let e = 0; e < g.m; e++) {
  const r = g.road(e); if (!r) continue;
  const k = keyK.get(`${r.c}:${r.i}`); if (k == null) continue;
  edgeRoad[e] = k;
  const a = edgesOfRoad.get(k); if (a) a.push(e); else edgesOfRoad.set(k, [e]);
}
const fromNode = (e: number) => { let lo = 0, hi = g.n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.off[mid] <= e) lo = mid; else hi = mid - 1; } return lo; };

const M_LAT = 110574;
function nearestEdge(lat: number, lon: number): { e: number; d: number } | null {
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let best: { e: number; d: number } | null = null;
  for (let u = 0; u < g.n; u++) {
    const ax = (g.nodeLon(u) - lon) * mLon, ay = (g.nodeLat(u) - lat) * M_LAT;
    if (Math.abs(ax) > 400 || Math.abs(ay) > 400) continue;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      if (!motorAllowedClass(g, e) || !CLOSABLE.has(g.highway(e))) continue;
      const pts = g.edgeCoords(e, u);
      for (let q = 1; q < pts.length; q++) {
        const px = (pts[q - 1][0] - lon) * mLon, py = (pts[q - 1][1] - lat) * M_LAT, qx = (pts[q][0] - lon) * mLon, qy = (pts[q][1] - lat) * M_LAT;
        const dx = qx - px, dy = qy - py, L = dx * dx + dy * dy;
        const t = L > 0 ? Math.max(0, Math.min(1, -(px * dx + py * dy) / L)) : 0;
        const d = Math.hypot(px + t * dx, py + t * dy);
        if (!best || d < best.d) best = { e, d };
      }
    }
  }
  return best && best.d <= GATE_M ? best : null;
}
function nearestRoad(lat: number, lon: number): { k: number; d: number } | null {
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let best: { k: number; d: number } | null = null;
  for (let k = 0; k < pack.n; k++) {
    const c = pack.coords(k);
    for (let q = 1; q < c.length; q++) {
      const ax = (c[q - 1][0] - lon) * mLon, ay = (c[q - 1][1] - lat) * M_LAT, bx = (c[q][0] - lon) * mLon, by = (c[q][1] - lat) * M_LAT;
      if (Math.min(Math.abs(ax), Math.abs(bx)) > GATE_M * 4 && Math.sign(ax) === Math.sign(bx)) continue;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const d = Math.hypot(ax + u * dx, ay + u * dy);
      if (!best || d < best.d) best = { k, d };
    }
  }
  return best && best.d <= GATE_M ? best : null;
}
const roadName = (k: number) => pack.str('name', k) || `jalan ${pack.highway(k)}`;
const roadLen = (k: number) => { const c = pack.coords(k); let s = 0; for (let i = 1; i < c.length; i++) s += Math.hypot((c[i][0] - c[i - 1][0]) * 111320 * Math.cos((c[i][1] * Math.PI) / 180), (c[i][1] - c[i - 1][1]) * M_LAT); return s; };
const mid = (k: number) => { const c = pack.coords(k); const m = c[Math.floor(c.length / 2)]; return { lat: m[1], lon: m[0] }; };

const t0 = Date.now();
const out: Array<Record<string, unknown>> = [];
const counts = { schools: 0, closable: 0, major_gate: 0, no_road: 0, no_detour: 0 };
const dbg = { no_edges: 0, no_ends: 0, no_route: 0 };
for (const f of list.fasilitas.filter((x) => x.kelas === 'pendidikan')) {
  counts.schools++;
  const nr = nearestRoad(f.lat, f.lon);
  if (!nr) { counts.no_road++; out.push({ id: f.id, status: 'tanpa_jalan', teks: 'Tidak ada jalan dalam 60 m dari titik sekolah di peta.' }); continue; }
  const hw = pack.highway(nr.k);
  if (!CLOSABLE.has(hw)) {
    counts.major_gate++;
    out.push({ id: f.id, status: 'jalan_utama', gerbang: { nama: roadName(nr.k), kelas: hw, jarak_m: Math.round(nr.d) },
      teks: `Sekolah ini menghadap ${roadName(nr.k)} (jalan ${hw}); menutup jalan utama tidak realistis. Pilihan lain: gerbang samping atau penyeberangan dan penghijauan.` });
    continue;
  }
  // gate in the motor graph: the nearest closable edge to the school (and its reverse); the detour joins its two ends
  const ge = nearestEdge(f.lat, f.lon);
  const gateEdges = new Set<number>();
  let detour: number[] = [], extra = 0;
  const term: number[] = [];
  if (ge) {
    const u = fromNode(ge.e), v = g.target[ge.e];
    term.push(u, v);
    for (const [a, b] of [[u, v], [v, u]]) for (let e = g.off[a]; e < g.off[a + 1]; e++) if (g.target[e] === b) gateEdges.add(e);
    const r = route(g, u, v, 0, { speed: 60 / 3.6, speedOf: (e) => motorSpeed(g, e), allowed: (e) => motorAllowedClass(g, e) && !gateEdges.has(e) });
    if (r) {
      const gateRoads = new Set([...gateEdges].map((e) => edgeRoad[e]));
      detour = [...new Set(r.edges.map((e) => edgeRoad[e]).filter((k) => k >= 0 && k !== nr.k && !gateRoads.has(k)))];
      extra = Math.max(0, r.lengthM - g.lenDm[ge.e] / 10);
    }
  }
  if (!detour.length) { counts.no_detour++; if (!gateEdges.size) dbg.no_edges++; else if (term.length < 2) dbg.no_ends++; else dbg.no_route++; }
  counts.closable++;
  const unit = unitContributions(sources, { lat: f.lat, lon: f.lon }, met);
  const extraUnits = unitContributions(sources, { lat: f.lat, lon: f.lon }, met, detour.filter((d) => !unit.has(d)));
  for (const [d, u] of extraUnits) unit.set(d, u);
  const veh = (j: number) => sources[j].vehPerHour;
  const eff = closureEffect(unit, veh, [nr.k], detour);
  const selfUnit = (d: number) => unitContributions(sources, mid(d), met, [d]).get(d) ?? 0;
  const imp = imposedOnDetour(selfUnit, eff.moved, detour, (d) => harga.value(cellOf[d], idxInCell[d]) ?? 1);
  const maxName = imp.maxAt >= 0 ? roadName(imp.maxAt) : null;
  out.push({
    id: f.id, status: detour.length ? 'ok' : 'tanpa_jalan_putar',
    gerbang: { nama: roadName(nr.k), kelas: hw, jarak_m: Math.round(nr.d), kendaraan_per_jam: Math.round(eff.moved) },
    asap_sebelum: Math.round(eff.before * 10) / 10, asap_sesudah: Math.round(eff.after * 10) / 10, perubahan_persen: eff.pct,
    jalan_putar_tambahan_m: Math.round(extra), kenaikan_terbesar: { jalan: maxName, asap: Math.round(imp.maxRise * 10) / 10 },
    ditimbulkan_tertimbang: Math.round(imp.weighted * 10) / 10,
    teks: detour.length ? closureText(eff, extra, imp.maxRise, maxName) : 'Tidak ada jalan putar untuk kendaraan; penutupan akan memutus akses.',
  });
}
const pcts = out.filter((r) => r.status === 'ok').map((r) => r.perubahan_persen as number).sort((a, b) => a - b);
const summary = { ...counts, median_perubahan_persen: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null, detik: (Date.now() - t0) / 1000 };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.json`), JSON.stringify({
  wilayah: name, dibuat: new Date().toISOString(),
  kondisi: { jam_lokal: HOUR, angin_m_s: WIND, stabilitas: met.stability, catatan: 'Kondisi acuan yang sama untuk semua sekolah; angka adalah model (NOx lalu lintas, µg/m³), belum diukur.' },
  ringkasan: summary, sekolah: out,
}));
console.log(JSON.stringify(summary), JSON.stringify(dbg));
