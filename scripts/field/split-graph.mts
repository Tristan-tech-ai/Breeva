/**
 * Splits each region's walking graph (BGR1) into <name>_inti.bin (and its smaller BGC1 form <name>_inti2.bin, F1-61)
 * and <name>_bentuk.bin next to it (F1-56,
 * src/lib/route/graphSplit.ts), and checks the split: the core read back routes on the same arrays, the shapes attached
 * give every edge the same polyline as the full graph.
 *   npx tsx scripts/field/split-graph.mts [--root D:/breeva-ml-data/field] [--region a,b]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCore, encodeCore } from '../../src/lib/route/coreCodec';
import { splitGraph } from '../../src/lib/route/graphSplit';
import { decodeShapes, encodeShapes } from '../../src/lib/route/shapeCodec';
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
  // F1-61: the smaller core form must give the core back byte for byte
  const core2 = encodeCore(core);
  const back = decodeCore(core2);
  if (back.length !== core.length || back.some((v, i) => v !== core[i])) throw new Error(`${name}: BGC1 core does not decode to the BGR1 core`);
  writeFileSync(join(dir, `${name}_inti.bin`), core);
  writeFileSync(join(dir, `${name}_inti2.bin`), core2);
  // F1-62: the smaller shapes form must give every edge the same polyline
  const shapes2 = encodeShapes(shapes, k);
  const k2 = new WalkGraph(core);
  k2.attachShapes(decodeShapes(shapes2, k2));
  let bad2 = 0;
  for (let u = 0; u < g.n; u++) {
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const a = g.edgeCoords(e, u), b = k2.edgeCoords(e, u);
      if (a.length !== b.length || a.some(([x, y], j) => x !== b[j][0] || y !== b[j][1])) bad2++;
    }
  }
  if (bad2) throw new Error(`${name}: ${bad2} edges differ with the BSC1 shapes`);
  writeFileSync(join(dir, `${name}_bentuk.bin`), shapes);
  writeFileSync(join(dir, `${name}_bentuk2.bin`), shapes2);
  console.log(JSON.stringify({ name, full: full.byteLength, inti: core.byteLength, inti2: core2.byteLength, bentuk2: shapes2.byteLength, bentuk: shapes.byteLength, edges: g.m, edges_same: true }));
}
