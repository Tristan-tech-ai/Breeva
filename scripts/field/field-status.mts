#!/usr/bin/env node
/**
 * Freshness of the published field, read the way the app reads it (through CloudFront).
 *
 *   pnpm exec tsx scripts/field/field-status.mts [--base https://d26tdym6xlfc4n.cloudfront.net] [--max-min 75]
 *
 * Prints one JSON line per region (run, computed_at, age in minutes, sensors, ok) and exits 1 when any manifest is
 * missing or older than --max-min. The status model is src/lib/field/status.ts, shared with the /status page.
 */
import { BUILD_REGIONS } from './regions.js';
import { FRESH_MINUTES, manifestStatus, type FieldStatus } from '../../src/lib/field/status.js';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'https://d26tdym6xlfc4n.cloudfront.net').replace(/\/$/, '');
const maxMin = Number(arg('--max-min', String(FRESH_MINUTES)));
let bad = 0;
for (const { name } of BUILD_REGIONS) {
  let s: FieldStatus;
  try {
    const r = await fetch(`${base}/v/${name}/manifest.json`, { cache: 'no-store' });
    s = r.ok ? manifestStatus(await r.json(), new Date(), maxMin) : { ok: false, error: `HTTP ${r.status}` };
  } catch (e) { s = { ok: false, error: (e as Error).message }; }
  if (!s.ok) bad++;
  console.log(JSON.stringify({ name, ...s }));
}
process.exit(bad ? 1 : 0);
