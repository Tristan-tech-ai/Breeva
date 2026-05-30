// One-off: confirm geom populated on road_aqi_precomputed + build the GIST index + ANALYZE.
// Direct pg (no PostgREST/MCP wall-clock limit on the index build).
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z0-9_]+)=(.*)/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const p = new Pool({ connectionString: env.SUPABASE_POOLER_URL, max: 2 });
const c = await p.query('SELECT count(*) AS tot, count(geom) AS with_geom, count(geojson) AS with_geojson FROM public.road_aqi_precomputed');
console.log('rows:', c.rows[0]);
const t = Date.now();
await p.query('CREATE INDEX IF NOT EXISTS idx_rap_geom ON public.road_aqi_precomputed USING gist(geom)');
console.log('GIST idx_rap_geom built in', ((Date.now() - t) / 1000).toFixed(1), 's');
await p.query('ANALYZE public.road_aqi_precomputed');
console.log('ANALYZE done');
await p.end();
