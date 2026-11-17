/**
 * Splits each region's walking graph (BGR1) into <name>_inti.bin and <name>_bentuk.bin next to it (F1-56,
 * src/lib/route/graphSplit.ts), and checks the split: the core read back routes on the same arrays, the shapes attached
 * give every edge the same polyline as the full graph.
 *   npx tsx scripts/field/split-graph.mts [--root D:/breeva-ml-data/field] [--region a,b]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitGraph } from '../../src/lib/route/graphSplit';
import { WalkGraph } from '../../src/lib/route/walkGraph';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('root', 'D:/breeva-ml-data/field');
const geometry = arg('geometry', '2026-11');
for (const name of arg('region', 'badung_denpasar,kota_bogor').split(',')) {
  const dir = join(root, 'graphs', geometry);
  const full = new Uint8Array(readFileSync(join(dir, `${name}.bin`)));
  const { core, shapes } = splitGraph(full);
  const g = new WalkGraph(full), k = new WalkGraph(core);
  if (k.hasShapes || k.n !== g.n || k.m !== g.m) throw new Error(`${name}: core does not match`);
  k.attachShapes(shapes);
  let bad = 0;
  for (let u = 0; u < g.n; u++) {
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const a = g.edgeCoords(e, u), b = k.edgeCoords(e, u);
      if (a.length !== b.length || a.some(([x, y], j) => x !== b[j][0] || y !== b[j][1])) bad++;
    }
  }
  if (bad) throw new Error(`${name}: ${bad} edges differ after attaching the shapes`);
  writeFileSync(join(dir, `${name}_inti.bin`), core);
  writeFileSync(join(dir, `${name}_bentuk.bin`), shapes);
  console.log(JSON.stringify({ name, full: full.byteLength, inti: core.byteLength, bentuk: shapes.byteLength, edges: g.m, edges_same: true }));
}
