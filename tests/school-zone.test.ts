import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WalkGraph } from '../src/lib/route/walkGraph';
import { route } from '../src/lib/route/router';
import { motorAllowedClass, motorNode } from '../src/lib/route/cost';
import {
  ARTERIAL, localMinutes, localTimeToMs, motorRouteAt, ownSchools, SCHOOL_HOURS, schoolActive, schoolEdges, schoolFilter,
  type SchoolFile,
} from '../src/lib/route/schoolZone';
import { routeCards, SCHOOL_NOTES, schoolCostText } from '../src/lib/route/summary';
// @ts-expect-error tsx script module, typed loosely here
import { schoolPoints } from '../scripts/field/build-schools.mts';

// 3 x 3 grid of about 110 m (vayu/field/make_graph_fixture.py)
const g = new WalkGraph(new Uint8Array(readFileSync('tests/fixtures/graph_small.bin')));
const edges = Array.from({ length: g.n }, (_, u) => Array.from({ length: g.off[u + 1] - g.off[u] }, (_, k) => ({ u, e: g.off[u] + k }))).flat();
const mid = (e: number, u: number): [number, number] => { const c = g.edgeCoords(e, u); const p = c[Math.floor(c.length / 2)]; return [p[1], p[0]]; };
const reverse = (e: number, u: number) => edges.find((x) => x.u === g.target[e] && g.target[x.e] === u)!.e;
const dist = (u: number, p: [number, number]) => Math.hypot((g.nodeLon(u) - p[1]) * 110574 * Math.cos((p[0] * Math.PI) / 180), (g.nodeLat(u) - p[0]) * 110574);
const file = (points: Array<[number, number]>): SchoolFile => ({ format: 'BSZ1', name: 't', geometry: 't', tz: 8, radius_m: 50, hours: SCHOOL_HOURS, points });
// 17 Nov 2026, local time in UTC+8
const at = (h: number, m = 0) => Date.UTC(2026, 10, 17, h - 8, m);

describe('school hours', () => {
  it('are 06.30-07.30 and 12.00-13.30 local time, end exclusive', () => {
    const f = file([]);
    expect([at(6, 29), at(6, 30), at(7, 29), at(7, 30), at(11, 59), at(12, 0), at(13, 29), at(13, 30), at(10)].map((x) => schoolActive(f, x)))
      .toEqual([false, true, true, false, false, true, true, false, false]);
    expect(localMinutes(Date.UTC(2026, 10, 16, 23, 0), 8)).toBe(7 * 60);
    expect(localMinutes(Date.UTC(2026, 10, 16, 23, 0), 7)).toBe(6 * 60);
  });

  it('a ?berangkat= clock time is that time on the region\'s current local date', () => {
    const now = Date.UTC(2026, 10, 16, 11, 30, 12); // 19.30 WITA on 16 Nov
    expect(localTimeToMs('07:00', 8, now)).toBe(Date.UTC(2026, 10, 15, 23, 0)); // 07.00 WITA 16 Nov
    expect(localTimeToMs('7.15', 7, now)).toBe(Date.UTC(2026, 10, 16, 0, 15)); // 07.15 WIB 16 Nov
    for (const bad of [null, '', '25:00', '07:60', 'pagi']) expect(localTimeToMs(bad, 8, now)).toBe(now);
  });
});

describe('school zone edges', () => {
  const { u, e } = edges[0];
  const school = mid(e, u);
  const es = schoolEdges(g, [school]);

  it('an edge passing a school belongs to it in both directions, edges farther than 50 m do not', () => {
    expect(es[e]).toBe(0);
    expect(es[reverse(e, u)]).toBe(0);
    // the only other edges are at least 55 m away (half a grid step from the nearest node)
    expect(Array.from(es).filter((k) => k === 0).length).toBe(2);
    expect(schoolEdges(g, []).every((k) => k === -1)).toBe(true);
  });

  it('the zone refuses a minor street past another school, spares arterials and the trip\'s own school, and is off outside hours', () => {
    const far = [...Array(g.n).keys()].filter((v) => dist(v, school) > 150 && v !== u && v !== g.target[e]);
    expect(far.length).toBeGreaterThanOrEqual(2);
    const [s, t] = far;
    const f = file([school]);
    expect(schoolFilter(g, f, es, s, t, at(10))).toBeNull();
    const allow = schoolFilter(g, f, es, s, t, at(7))!;
    expect(allow(e)).toBe(ARTERIAL.has(g.highway(e)));
    expect(schoolFilter(g, f, es, s, t, at(7), true)!(e)).toBe(false);
    for (const x of edges) if (es[x.e] < 0) expect(allow(x.e)).toBe(true);
    // a trip that starts at the school end of the edge: the school is its own, its frontage open
    expect(ownSchools(g, [school], es, u, t).has(0)).toBe(true);
    expect(schoolFilter(g, f, es, u, t, at(7))!(e)).toBe(true);
  });

  it('motor routes keep the zone when they can, and never take a refused edge then', () => {
    const f = file([school]);
    let kept = 0;
    for (let s = 0; s < g.n; s++) for (let t = 0; t < g.n; t++) {
      if (s === t || !motorNode(g, s) || !motorNode(g, t)) continue;
      const off = motorRouteAt(route, g, 'motor', s, t, { no2: new Float64Array(g.m).fill(10) }, { file: f, edgeSchool: es }, at(10));
      if (off) expect(off.school).toBe('off');
      const r = motorRouteAt(route, g, 'motor', s, t, { no2: new Float64Array(g.m).fill(10) }, { file: f, edgeSchool: es }, at(7));
      if (!r) continue;
      expect(['kept', 'lifted-near-ends']).toContain(r.school);
      for (const x of r.route.edges) expect(motorAllowedClass(g, x)).toBe(true);
      if (r.school === 'kept') {
        kept++;
        const allow = schoolFilter(g, f, es, s, t, at(7))!;
        for (const x of r.route.edges) expect(allow(x)).toBe(true);
      }
    }
    expect(kept).toBeGreaterThan(0);
  });

  it('the zone-free route the worker compares with is never longer in time than the zoned one by search', () => {
    const f = file([school]);
    let compared = 0;
    for (let s = 0; s < g.n; s++) for (let t = 0; t < g.n; t++) {
      if (s === t || !motorNode(g, s) || !motorNode(g, t)) continue;
      const inp = { no2: new Float64Array(g.m).fill(10) };
      const zoned = motorRouteAt(route, g, 'motor', s, t, inp, { file: f, edgeSchool: es }, at(7), true);
      const free = motorRouteAt(route, g, 'motor', s, t, inp, null, at(7), true);
      if (!zoned || !free || zoned.school === 'off') continue;
      expect(free.school).toBe('off');
      // the emergency route is the fastest one: dropping a restriction can only keep or shorten its time
      expect(free.route.timeS).toBeLessThanOrEqual(zoned.route.timeS + 1e-6);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe('school points and notes', () => {
  it('keeps schools and kindergartens from the OSM extract, one point each', () => {
    const pts = schoolPoints([
      { lat: -8.1, lon: 115.1, tags: { amenity: 'school' } },
      { lat: -8.1, lon: 115.1, tags: { amenity: 'school' } },
      { center: { lat: -8.2, lon: 115.2 }, tags: { amenity: 'kindergarten' } },
      { lat: -8.3, lon: 115.3, tags: { amenity: 'hospital' } },
      { lat: -8.4, lon: 115.4, tags: { amenity: 'university' } },
    ]);
    expect(pts).toEqual([[-8.1, 115.1], [-8.2, 115.2]]);
  });

  it('a tutoring centre or course tagged as a school makes no zone; a school with a level in its name does (X-W93)', () => {
    const pts = schoolPoints([
      { lat: -8.64794, lon: 115.19524, tags: { amenity: 'school', name: 'Primagama Buluh Indah Denpasar' } },
      { lat: -6.55804, lon: 106.77255, tags: { amenity: 'school', name: 'English First Taman Yasmin' } },
      { lat: -8.5, lon: 115.5, tags: { amenity: 'school', name: 'SMK/SMA Pembangunan & Akademi Akuntansi Denpasar' } },
      { lat: -8.6, lon: 115.6, tags: { amenity: 'kindergarten', name: 'TK Negeri Motekar' } },
    ]);
    expect(pts).toEqual([[-8.5, 115.5], [-8.6, 115.6]]);
  });

  it('route cards say what the school zone did', () => {
    const base = { lengthM: 1000, timeS: 200, pm25Mean: 20, no2Mean: 15, coords: [], w: 0 };
    const cards = routeCards([{ ...base, kind: 'darurat', school: 'lifted-near-ends' }, { ...base, kind: 'dua-angka', school: 'kept' }, { ...base, school: 'off' }]);
    expect(cards.map((c) => c.schoolNote)).toEqual([SCHOOL_NOTES['lifted-near-ends'], SCHOOL_NOTES.kept, null]);
  });

  it('route cards say what the school zone costs, or that it changes nothing (F3-09)', () => {
    expect(schoolCostText({ extraM: 0, extraS: 0, changed: false })).toBe('Zona sekolah tidak mengubah rute ini');
    expect(schoolCostText({ extraM: 420, extraS: 95, changed: true })).toBe('Zona sekolah menambah 2 menit dan 420 m dibanding rute tanpa zona');
    expect(schoolCostText({ extraM: 1260, extraS: 20, changed: true })).toBe('Zona sekolah menambah kurang dari 1 menit dan 1.260 m dibanding rute tanpa zona');
    expect(schoolCostText({ extraM: 10, extraS: 10, changed: true })).toBe('Zona sekolah mengubah jalannya, tanpa tambahan waktu yang berarti');
    // a real Bogor trip (motor-bench seed, 17 Nov): the zoned route is longer but quicker
    expect(schoolCostText({ extraM: 564, extraS: -266, changed: true })).toBe('Zona sekolah mengubah rute: 560 m lebih jauh, 4 menit lebih cepat dibanding rute tanpa zona');
    expect(schoolCostText({ extraM: -300, extraS: 20, changed: true })).toBe('Zona sekolah mengubah rute: 300 m lebih dekat dibanding rute tanpa zona');
    expect(schoolCostText(undefined)).toBeNull();
    const base = { lengthM: 1000, timeS: 200, pm25Mean: 20, no2Mean: 15, coords: [], w: 0 };
    const cards = routeCards([{ ...base, kind: 'dua-angka', school: 'kept', schoolCost: { extraM: 300, extraS: 70, changed: true } },
      { ...base, school: 'off', schoolCost: { extraM: 300, extraS: 70, changed: true } }]);
    expect(cards.map((c) => c.schoolCost)).toEqual(['Zona sekolah menambah 1 menit dan 300 m dibanding rute tanpa zona', null]);
  });

});
