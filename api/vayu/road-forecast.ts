/**
 * Tier 4 Phase 4.4 — Per-road 24h PM2.5 forecast endpoint.
 *
 * GET /api/vayu/road-forecast?osm_way_id=12345&h=24
 *
 * Reads the latest anchor row per (osm_way_id, forecast_hour) from
 * public.stgcn_predictions (populated by vayu/ml/precompute_stgcn.py). Returns
 * mu + uncertainty bands as a flat list, hourly increments. When the ST-GNN
 * model hasn't been trained yet, returns an empty forecast (200) — callers
 * should fall back to the snapshot road-aqi endpoint.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ForecastRow {
  forecast_hour: number;
  predicted_pm25: number;
  uncertainty_sigma: number | null;
  model_version: string;
  forecast_anchor: string;
}

interface ForecastPoint {
  hour_offset: number;
  pm25: number;
  sigma: number;
  pi95_lower: number;
  pi95_upper: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const osmWayId = Number(req.query.osm_way_id);
  const horizon = Math.max(1, Math.min(24, Number(req.query.h ?? '24')));

  if (!Number.isFinite(osmWayId) || osmWayId <= 0) {
    res.status(400).json({ error: 'osm_way_id required' });
    return;
  }

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    res.status(503).json({ error: 'supabase env missing' });
    return;
  }

  // 1) Find most recent forecast_anchor for this road
  const anchorQs = new URLSearchParams({
    osm_way_id: `eq.${osmWayId}`,
    select: 'forecast_anchor',
    order: 'forecast_anchor.desc',
    limit: '1',
  });
  let anchorIso: string | null = null;
  try {
    const r = await fetch(`${supaUrl}/rest/v1/stgcn_predictions?${anchorQs}`, {
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
      },
    });
    if (r.ok) {
      const rows = (await r.json()) as Array<{ forecast_anchor: string }>;
      anchorIso = rows[0]?.forecast_anchor ?? null;
    }
  } catch {
    // table likely doesn't exist yet — graceful empty
    res.json({ osm_way_id: osmWayId, forecast: [], model_version: null });
    return;
  }

  if (!anchorIso) {
    res.json({ osm_way_id: osmWayId, forecast: [], model_version: null });
    return;
  }

  // 2) Pull the 24 hourly rows for that anchor
  const rowQs = new URLSearchParams({
    osm_way_id: `eq.${osmWayId}`,
    forecast_anchor: `eq.${anchorIso}`,
    order: 'forecast_hour.asc',
    limit: String(horizon),
    select: 'forecast_hour,predicted_pm25,uncertainty_sigma,model_version,forecast_anchor',
  });
  const r2 = await fetch(`${supaUrl}/rest/v1/stgcn_predictions?${rowQs}`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  });
  if (!r2.ok) {
    res.status(502).json({ error: 'stgcn_predictions read failed' });
    return;
  }
  const rows = (await r2.json()) as ForecastRow[];
  const forecast: ForecastPoint[] = rows.map((row) => {
    const sigma = row.uncertainty_sigma ?? 5;
    return {
      hour_offset: row.forecast_hour,
      pm25: row.predicted_pm25,
      sigma,
      pi95_lower: Math.max(0, row.predicted_pm25 - 1.96 * sigma),
      pi95_upper: row.predicted_pm25 + 1.96 * sigma,
    };
  });

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.json({
    osm_way_id: osmWayId,
    forecast_anchor: anchorIso,
    model_version: rows[0]?.model_version ?? null,
    forecast,
  });
}
