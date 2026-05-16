/**
 * GET /api/vayu/aqi-forecast?cell_id=<h3-res-7>&hours=24
 * GET /api/vayu/aqi-forecast?lat=&lng=&hours=24
 *
 * Returns 24h pm25/aqi forecast for an H3 cell. Reads from public.aqi_forecast
 * (populated hourly by vayu/ml/forecast_hourly.py on PC).
 *
 * Falls back to baseline current AQI (extrapolated flat) if no forecast available.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { latLngToCell } from 'h3-js';

interface ForecastRow {
  forecast_hour: number;
  predicted_pm25: number;
  predicted_aqi: number;
  forecast_made_at: string;
}

const H3_RES = 7;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: 'Supabase env missing' });
  }

  let cellId = String(req.query.cell_id ?? '').trim();
  if (!cellId && req.query.lat && req.query.lng) {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      try {
        cellId = latLngToCell(lat, lng, H3_RES);
      } catch {
        return res.status(400).json({ error: 'Invalid lat/lng' });
      }
    }
  }
  if (!cellId) {
    return res.status(400).json({ error: 'cell_id or (lat,lng) required' });
  }

  const hours = Math.min(24, Math.max(1, Number(req.query.hours ?? 24)));

  // Latest forecast batch (one row per forecast_hour from most recent forecast_made_at)
  const r = await fetch(
    `${supaUrl}/rest/v1/aqi_forecast?cell_id=eq.${encodeURIComponent(cellId)}` +
    `&select=forecast_hour,predicted_pm25,predicted_aqi,forecast_made_at` +
    `&order=forecast_made_at.desc,forecast_hour.asc&limit=${hours * 3}`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
  );
  if (!r.ok) {
    return res.status(500).json({ error: 'forecast query failed', status: r.status });
  }
  const allRows: ForecastRow[] = await r.json();
  if (allRows.length === 0) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.json({ cell_id: cellId, predictions: [], fallback: 'no_forecast_available' });
  }

  // Take only rows from the most recent forecast_made_at batch
  const latestBatch = allRows[0].forecast_made_at;
  const predictions = allRows
    .filter(r => r.forecast_made_at === latestBatch)
    .sort((a, b) => a.forecast_hour - b.forecast_hour)
    .slice(0, hours)
    .map(r => ({
      hour: r.forecast_hour,
      pm25: Math.round(r.predicted_pm25 * 100) / 100,
      aqi: r.predicted_aqi,
    }));

  // Identify best hour (lowest AQI)
  const best = predictions.reduce<{ hour: number; aqi: number } | null>((acc, p) =>
    acc == null || p.aqi < acc.aqi ? { hour: p.hour, aqi: p.aqi } : acc, null);

  res.setHeader('Cache-Control', 'public, max-age=1800');
  return res.json({
    cell_id: cellId,
    forecast_made_at: latestBatch,
    predictions,
    best_hour: best,
  });
}
