// Run build_gcn_graph() for all 10 regions sequentially via direct pooler.
// MCP execute_sql times out at 60s; some regions take 2-5 min.
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: '.env.local' });

const POOLER_URL = process.env.SUPABASE_POOLER_URL;
if (!POOLER_URL) {
  console.error('SUPABASE_POOLER_URL missing');
  process.exit(1);
}

// Smallest → largest so failures fail fast
const REGIONS = [
  'denpasar', 'makassar', 'palembang', 'yogyakarta', 'medan',
  'semarang', 'bandung', 'surabaya', 'bali', 'jakarta'
];

const client = new pg.Client({
  connectionString: POOLER_URL,
  statement_timeout: 0,
  query_timeout: 0,
});

async function main() {
  console.log('connecting...');
  await client.connect();
  await client.query('SET statement_timeout = 0');
  await client.query('SET lock_timeout = 0');
  console.log('connected.\n');

  for (const region of REGIONS) {
    const t0 = Date.now();
    process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${region.padEnd(12)} `);
    try {
      const r = await client.query(
        'SELECT * FROM public.build_gcn_graph($1, 5.0, 50.0, 6)',
        [region],
      );
      const { nodes_inserted, edges_inserted } = r.rows[0];
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`nodes=${nodes_inserted} edges=${edges_inserted} (${dt}s)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }

  // Final verification
  console.log('\n=== final state ===');
  const v = await client.query(`
    SELECT n.region,
           COUNT(DISTINCT n.node_id)::int AS nodes,
           COUNT(DISTINCT e.edge_id)::int AS edges
    FROM gcn_graph_nodes n
    LEFT JOIN gcn_graph_edges e ON e.source_node = n.node_id
    GROUP BY n.region
    ORDER BY nodes DESC
  `);
  for (const row of v.rows) {
    const deg = (row.edges / Math.max(row.nodes, 1)).toFixed(1);
    console.log(`  ${row.region.padEnd(12)} nodes=${row.nodes.toString().padStart(7)} edges=${row.edges.toString().padStart(8)} avg_degree=${deg}`);
  }

  await client.end();
  console.log('done.');
}

main().catch(e => { console.error('error:', e.message); process.exit(1); });
