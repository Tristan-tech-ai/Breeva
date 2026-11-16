#!/usr/bin/env node
/**
 * Freshness of the published field, read the way the app reads it (through CloudFront).
 *
 *   node scripts/field/field-status.mjs [--base https://d26tdym6xlfc4n.cloudfront.net] [--max-min 75]
 *
 * Prints one JSON line per region (run, computed_at, age in minutes, sensors, ok) and exits 1 when any manifest is
 * missing or older than --max-min (the freshness target of ROADMAP_BREEVA_3: at most 75 minutes).
 */
import { pathToFileURL } from 'node:url';

export const REGIONS = ['badung_denpasar', 'kota_bogor'];

/** @param {{ run?: string, computed_at?: string, sensors_used?: number, measurement?: { method?: string } }} m */
export function manifestStatus(m, now, maxMin = 75) {
  const t = Date.parse(m?.computed_at ?? '');
  if (!m?.run || !Number.isFinite(t)) return { ok: false, error: 'manifest without run or computed_at' };
  const ageMin = Math.round(((now.getTime() - t) / 60000) * 10) / 10;
  return { run: m.run, computed_at: m.computed_at, age_min: ageMin, sensors: m.sensors_used ?? 0, method: m.measurement?.method ?? null, ok: ageMin >= -5 && ageMin <= maxMin };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const base = arg('--base', 'https://d26tdym6xlfc4n.cloudfront.net').replace(/\/$/, '');
  const maxMin = Number(arg('--max-min', '75'));
  let bad = 0;
  for (const name of REGIONS) {
    let s;
    try {
      const r = await fetch(`${base}/v/${name}/manifest.json`, { cache: 'no-store' });
      s = r.ok ? manifestStatus(await r.json(), new Date(), maxMin) : { ok: false, error: `HTTP ${r.status}` };
    } catch (e) { s = { ok: false, error: e.message }; }
    if (!s.ok) bad++;
    console.log(JSON.stringify({ name, ...s }));
  }
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
