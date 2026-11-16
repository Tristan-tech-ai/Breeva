#!/usr/bin/env node
// Copies the current field (manifest, its run's cells, PMTiles) from the field store into public/field so `pnpm dev`
// serves it at /field. Usage: node scripts/field/stage-dev.mjs [--root D:/breeva-ml-data/field] [--region badung_denpasar]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('root', 'D:/breeva-ml-data/field');
const regions = (arg('region', 'badung_denpasar')).split(',');
const out = 'public/field';

for (const region of regions) {
  const man = JSON.parse(readFileSync(join(root, 'v', region, 'manifest.json'), 'utf8'));
  const runSrc = join(root, 'v', region, man.run);
  const runDst = join(out, 'v', region, man.run);
  rmSync(join(out, 'v', region), { recursive: true, force: true });
  mkdirSync(runDst, { recursive: true });
  for (const f of readdirSync(runSrc)) if (f.endsWith('.bin')) copyFileSync(join(runSrc, f), join(runDst, f));
  copyFileSync(join(root, 'v', region, 'manifest.json'), join(out, 'v', region, 'manifest.json'));
  const tiles = join(root, 'tiles', man.geometry, `${region}.pmtiles`);
  if (!existsSync(tiles)) throw new Error(`missing ${tiles}`);
  mkdirSync(join(out, 'tiles', man.geometry), { recursive: true });
  copyFileSync(tiles, join(out, 'tiles', man.geometry, `${region}.pmtiles`));
  console.log(`staged ${region}: run ${man.run}, ${man.cells.length} cells, tiles ${man.geometry}`);
}
