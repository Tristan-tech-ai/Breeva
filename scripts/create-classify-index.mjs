// One-shot: create the partial composite index needed by classify-backlog's
// fetchNext query. The MCP apply_migration tool times out the HTTP request
// after ~60s (long enough that the CREATE INDEX rolls back when the
// connection drops). Direct pooler connection holds open until the DDL
// completes.
//
// Run: node scripts/create-classify-index.mjs

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: '.env.local' });

const POOLER_URL = process.env.SUPABASE_POOLER_URL;
if (!POOLER_URL) {
  console.error('SUPABASE_POOLER_URL missing from .env.local');
  process.exit(1);
}

const client = new pg.Client({ connectionString: POOLER_URL, statement_timeout: 0, query_timeout: 0 });

async function main() {
  console.log('connecting via pooler...');
  await client.connect();
  console.log('connected.');

  // Cancel any stale build attempts before retrying — they hold AccessShare
  // and would conflict with the new attempt.
  console.log('checking for stale builds...');
  const stale = await client.query(`
    SELECT pid, now() - query_start AS elapsed
    FROM pg_stat_activity
    WHERE state = 'active' AND query ILIKE '%idx_road_unclassified_cursor%' AND pid <> pg_backend_pid()
  `);
  for (const row of stale.rows) {
    console.log(`cancelling stale build PID=${row.pid} elapsed=${row.elapsed}`);
    await client.query('SELECT pg_cancel_backend($1)', [row.pid]);
  }
  if (stale.rows.length > 0) {
    console.log('waiting 3s for cancel to take effect...');
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('checking if index already exists...');
  const exists = await client.query(
    `SELECT 1 FROM pg_indexes WHERE tablename='road_segments' AND indexname='idx_road_unclassified_cursor'`,
  );
  if (exists.rowCount > 0) {
    console.log('index already exists. nothing to do.');
    await client.end();
    return;
  }

  console.log('setting statement_timeout=0 for this session...');
  await client.query('SET statement_timeout = 0');
  await client.query('SET lock_timeout = 0');

  console.log('creating index (may take 1-3 min)...');
  const t0 = Date.now();
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_road_unclassified_cursor
    ON road_segments (region, osm_way_id)
    WHERE ai_classified_at IS NULL
  `);
  console.log(`created in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await client.end();
  console.log('done.');
}

main().catch((e) => {
  console.error('error:', e.message);
  process.exit(1);
});
