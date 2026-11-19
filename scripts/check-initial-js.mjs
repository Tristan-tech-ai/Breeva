/**
 * Budget for the JavaScript a first visit downloads before anything else (roadmap KPI "JS awal < 180 KB gzip"):
 * the entry script plus every module it preloads, as listed in dist/index.html, gzip level 9.
 *
 *   node scripts/check-initial-js.mjs [dist] [budget_bytes]     (run after vite build; exit 1 over budget)
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
// 180 KB as the papers count it (1 KB = 1000 bytes; before 20 Nov this was 180 KiB = 184,320 bytes)
const budget = Number(process.argv[3] ?? 180_000);
const html = readFileSync(`${dist}/index.html`, 'utf8');
const files = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
if (!files.length) { console.error('no script in dist/index.html'); process.exit(1); }
let total = 0;
for (const f of files) {
  const g = gzipSync(readFileSync(dist + f), { level: 9 }).length;
  total += g;
  console.log(`${f} ${g}`);
}
console.log(`initial JS ${total} bytes gzip, budget ${budget}`);
if (total > budget) { console.error(`initial JS over budget by ${total - budget} bytes`); process.exit(1); }
