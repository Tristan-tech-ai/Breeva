/**
 * School points of a region for the school breathing zone (task F3-07, src/lib/route/schoolZone.ts), from the
 * OpenStreetMap facility extract of vayu/field/extract_facilities.py: amenity school and kindergarten, one point per
 * mapped node or area (an area's representative point), duplicates closer than about 1 m merged. Version 2 adds the OSM
 * name and kind of each point (aligned with points) for the "Ke sekolah" picker (task F1-12).
 *
 *   pnpm exec tsx scripts/field/build-schools.mts --name badung_denpasar \
 *        --facilities D:/breeva-ml-data/field/osm/badung_denpasar_facilities.json [--field D:/breeva-ml-data/field]
 * Writes <field>/graphs/<geometry>/<name>_schools.json (BSZ1), published with the walking graph.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_REGIONS } from './regions.js';
import { SCHOOL_HOURS, SCHOOL_RADIUS_M, type SchoolFile } from '../../src/lib/route/schoolZone.js';
import { courseReason } from './facility-clean.js';

interface Element { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export interface SchoolEntryRaw { p: [number, number]; name: string; kind: 'school' | 'kindergarten' }

/** One entry per school point: the first mapped name wins when a node and an area share a point. */
export function schoolEntries(elements: Element[]): SchoolEntryRaw[] {
  const at = new Map<string, SchoolEntryRaw>();
  for (const el of elements) {
    const a = el.tags?.amenity;
    if (a !== 'school' && a !== 'kindergarten') continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const p: [number, number] = [Number(lat.toFixed(5)), Number(lon.toFixed(5))];
    const k = p.join(',');
    const name = (el.tags?.name ?? '').trim();
    // tutoring centres, courses and adult education tagged as schools make no breathing zone (X-W93, same rule as the priority list)
    if (courseReason(name, a)) continue;
    const had = at.get(k);
    if (!had) at.set(k, { p, name, kind: a });
    else if (!had.name && name) had.name = name;
  }
  return [...at.values()];
}

export function schoolPoints(elements: Element[]): Array<[number, number]> {
  return schoolEntries(elements).map((e) => e.p);
}

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
if (process.argv[1]?.endsWith('build-schools.mts')) {
  const name = arg('name')!;
  const region = BUILD_REGIONS.find((r) => r.name === name);
  if (!region) throw new Error(`unknown region ${name}`);
  const src = JSON.parse(readFileSync(arg('facilities')!, 'utf8')) as { source?: string; elements: Element[] };
  const entries = schoolEntries(src.elements);
  const f: SchoolFile & { source: string; built_at: string } = {
    format: 'BSZ1', version: 2, name, geometry: region.geometry, tz: region.tz, radius_m: SCHOOL_RADIUS_M, hours: SCHOOL_HOURS,
    points: entries.map((e) => e.p), names: entries.map((e) => e.name), kinds: entries.map((e) => e.kind),
    source: src.source ?? 'OpenStreetMap (ODbL)', built_at: new Date().toISOString(),
  };
  const out = join(arg('field', 'D:/breeva-ml-data/field')!, 'graphs', region.geometry, `${name}_schools.json`);
  writeFileSync(out, JSON.stringify(f));
  console.log(JSON.stringify({ out, schools: f.points.length, named: entries.filter((e) => e.name).length, tz: f.tz }));
}
