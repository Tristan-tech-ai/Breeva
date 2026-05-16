/**
 * GET /api/vayu/road-narrative?osm_way_id=12345
 *
 * Returns AI-generated narrative for a specific road. Populated by
 * gemini-classify?mode=narrative cron / manual triggers.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

interface NarrativeRow {
  osm_way_id: number;
  name: string | null;
  highway: string;
  region: string;
  ai_narrative: string | null;
  ai_narrative_grounded_at: string | null;
  ai_narrative_sources: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: 'Supabase env missing' });
  }

  const id = req.query.osm_way_id?.toString();
  if (!id) return res.status(400).json({ error: 'osm_way_id required' });

  const r = await fetch(
    `${supaUrl}/rest/v1/road_segments?osm_way_id=eq.${encodeURIComponent(id)}` +
    `&select=osm_way_id,name,highway,region,ai_narrative,ai_narrative_grounded_at,ai_narrative_sources` +
    `&limit=1`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
  );

  if (!r.ok) {
    return res.status(500).json({ error: 'lookup failed', status: r.status });
  }
  const rows = await r.json() as NarrativeRow[];
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: 'Road not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');

  let parsed: Record<string, unknown> | null = null;
  if (row.ai_narrative) {
    try {
      parsed = JSON.parse(row.ai_narrative);
    } catch {
      // Narrative was non-JSON (rare; older fallback). Return as text.
      parsed = { summary: row.ai_narrative };
    }
  }

  return res.json({
    osm_way_id: row.osm_way_id,
    name: row.name,
    highway: row.highway,
    region: row.region,
    narrative: parsed,
    grounded_at: row.ai_narrative_grounded_at,
    sources: row.ai_narrative_sources ?? [],
  });
}
