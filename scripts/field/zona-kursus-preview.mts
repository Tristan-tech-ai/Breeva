/**
 * X-W93 measurement before any change: which points of a region's school breathing-zone file (graphs/<geometry>/<name>_schools.json)
 * the course rule of scripts/field/facility-clean.ts would remove, and whether any lies within the zone radius of the demo
 * routes' roads (the caller checks the routes; this lists the points).
 *
 *   pnpm exec tsx scripts/field/zona-kursus-preview.mts D:/breeva-ml-data/field/graphs/2026-11/kota_bogor_schools.json
 */
import { readFileSync } from 'node:fs';
import { courseReason } from './facility-clean.js';

const f = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { points: Array<[number, number]>; names: string[]; kinds: string[]; radius_m: number };
const out = f.points.map((p, k) => ({ p, nama: f.names[k], jenis: f.kinds[k], alasan: courseReason(f.names[k], f.kinds[k]) })).filter((x) => x.alasan);
console.log(JSON.stringify({ titik: f.points.length, radius_m: f.radius_m, keluar: out.length, daftar: out }));
