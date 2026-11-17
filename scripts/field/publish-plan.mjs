/**
 * Which local field files go to which S3 key, with which Cache-Control (LAMPIRAN_TEKNIS L1). Pure, so it is tested.
 *
 *   tiles/{geometry}/{name}.pmtiles     public, max-age=31536000, immutable       (L1.2)
 *   v/{name}/{run}/{c}.bin              public, max-age=31536000, immutable       (L1.3, runs are never overwritten)
 *   v/{name}/manifest.json              public, max-age=60, stale-while-revalidate=600 (L1.4), uploaded LAST
 *   harga/{geometry}/{name}.bin         public, max-age=86400  (from harga/{geometry}/client/{name}.bin), gzip
 *   graphs/{geometry}/{name}.bin        public, max-age=86400, gzip
 *   graphs/{geometry}/{name}_schools.json  public, max-age=86400 (school zone points, F3-07)
 * inputs.json and report.json of a run stay local.
 * gzip: stored with Content-Encoding: gzip (browsers decode it themselves). Only files always read whole: CloudFront
 * does not compress application/octet-stream, and the walking graph went out at 3.2 MB (1.5 MB gzip), about 64 s on a
 * slow 3G link (F1-53). The PMTiles archive is read by byte range, so it stays plain.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const MANIFEST = 'public, max-age=60, stale-while-revalidate=600';
export const DAILY = 'public, max-age=86400';

export function planUploads(root, regions) {
  const out = [];
  const last = [];
  for (const name of regions) {
    const manPath = join(root, 'v', name, 'manifest.json');
    const man = JSON.parse(readFileSync(manPath, 'utf8'));
    const g = man.geometry;
    const tiles = join(root, 'tiles', g, `${name}.pmtiles`);
    if (!existsSync(tiles)) throw new Error(`missing ${tiles}`);
    out.push({ local: tiles, key: `tiles/${g}/${name}.pmtiles`, cacheControl: IMMUTABLE, contentType: 'application/octet-stream' });
    const runDir = join(root, 'v', name, man.run);
    for (const c of man.cells) {
      const f = join(runDir, `${c}.bin`);
      if (!existsSync(f)) throw new Error(`manifest ${name} lists cell ${c} but ${f} is missing`);
      out.push({ local: f, key: `v/${name}/${man.run}/${c}.bin`, cacheControl: IMMUTABLE, contentType: 'application/octet-stream' });
    }
    const extra = readdirSync(runDir).filter((f) => f.endsWith('.bin') && !man.cells.includes(Number(f.replace('.bin', ''))));
    if (extra.length) throw new Error(`run ${name}/${man.run} has cells the manifest does not list: ${extra.join(', ')}`);
    const harga = join(root, 'harga', g, 'client', `${name}.bin`);
    if (existsSync(harga)) out.push({ local: harga, key: `harga/${g}/${name}.bin`, cacheControl: DAILY, contentType: 'application/octet-stream', gzip: true });
    const graph = join(root, 'graphs', g, `${name}.bin`);
    if (existsSync(graph)) out.push({ local: graph, key: `graphs/${g}/${name}.bin`, cacheControl: DAILY, contentType: 'application/octet-stream', gzip: true });
    const schools = join(root, 'graphs', g, `${name}_schools.json`);
    if (existsSync(schools)) out.push({ local: schools, key: `graphs/${g}/${name}_schools.json`, cacheControl: DAILY, contentType: 'application/json' });
    last.push({ local: manPath, key: `v/${name}/manifest.json`, cacheControl: MANIFEST, contentType: 'application/json' });
  }
  return [...out, ...last];
}
