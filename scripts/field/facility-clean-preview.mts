/**
 * Preview of the facility cleaning (scripts/field/facility-clean.ts) on a published priority list: what would be dropped
 * and merged, before the list is rebuilt.
 *
 *   pnpm exec tsx scripts/field/facility-clean-preview.mts public/data/prioritas/kota_bogor.json
 */
import { readFileSync } from 'node:fs';
import { courseReason, mergeFacilities, type Ranked } from './facility-clean.js';

const list = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { fasilitas: Array<Ranked & { peringkat: number }> };
const dropped = list.fasilitas.filter((f) => courseReason(f.nama, f.jenis)).map((f) => ({ peringkat: f.peringkat, nama: f.nama, alasan: courseReason(f.nama, f.jenis) }));
const kept = list.fasilitas.filter((f) => !courseReason(f.nama, f.jenis));
const { items, merges } = mergeFacilities(kept);
console.log(JSON.stringify({ sebelum: list.fasilitas.length, dikeluarkan: dropped, digabung: merges, sesudah: items.length }, null, 1));
