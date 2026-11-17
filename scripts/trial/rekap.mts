/**
 * Teacher's tally of the student trial (task F4-07): reads any text holding BRV1 codes (a Google Form export as CSV,
 * a chat copy, one code per line) and prints the counts gate G4 needs. Codes carry no name and no location.
 *   npx tsx scripts/trial/rekap.mts jawaban.csv [--jendela 2026-11-26,2026-12-02]
 */
import { readFileSync } from 'node:fs';
import { findCodes, rekap } from '../../src/lib/trial/diary';

const args = process.argv.slice(2);
const w = args.indexOf('--jendela');
const window = w >= 0 ? (args[w + 1].split(',') as [string, string]) : undefined;
const files = args.filter((a, k) => a !== '--jendela' && (w < 0 || k !== w + 1));
if (!files.length) {
  console.error('pakai: npx tsx scripts/trial/rekap.mts <berkas jawaban> [--jendela YYYY-MM-DD,YYYY-MM-DD]');
  process.exit(2);
}
const codes = files.flatMap((f) => findCodes(readFileSync(f, 'utf8')));
const r = rekap(codes, window);
console.log(JSON.stringify({ ...r, gerbang_G4: { syarat: '>= 15 siswa memakai >= 5 hari', lulus: r.peserta_min_5_hari >= 15 } }, null, 1));
