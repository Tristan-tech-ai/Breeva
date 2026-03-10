import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import * as h3 from 'h3-js';
import { computeDispersion } from '../../src/lib/vayu/dispersion';
import { getFreshness } from '../../src/lib/vayu/circuit-breaker';
import type { Freshness } from '../../src/lib/vayu/circuit-breaker';

// -- Supabase admin client --
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// -- Upstash Redis helpers (REST API) --
async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.result ?? null;
  } catch {
    return null;
  }
}

async function redisSetEx(key: string, ttl: number, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal */ }
}

// -- AQI Response type --
interface AQIResponse {
  tile_id: string;
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  co: number;
  o3: number;
  confidence: number;
  layer_source: number;
  freshness: Freshness;
  computed_at: string;
  region: string;
  degraded_sources?: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon query parameters required' });
  }

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lon as string);
  if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    // Step 1: lat/lon → H3 tile_id (resolution 11 ≈ 25m hexagon)
    const tileId = h3.latLngToCell(latitude, longitude, 11);
    const redisKey = `vayu:tile:${tileId}`;

    // Step 2: Check Upstash Redis cache (TTL 900s = 15 min)
    const cached = await redisGet(redisKey);
    if (cached) {
      const data = JSON.parse(cached) as AQIResponse;
      data.freshness = getFreshness(new Date(data.computed_at));
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.setHeader('X-Cache', 'HIT-REDIS');
      return res.status(200).json({ data });
    }

    // Step 3: Check Supabase aqi_grid table (cache layer 2)
    const supabase = getSupabase();
    const { data: gridRow } = await supabase
      .from('aqi_grid')
      .select('*')
      .eq('tile_id', tileId)
      .gt('valid_until', new Date().toISOString())
      .single();

    if (gridRow) {
      const data: AQIResponse = {
        tile_id: tileId,
        aqi: gridRow.aqi,
        pm25: gridRow.pm25,
        pm10: gridRow.pm10,
        no2: gridRow.no2,
        co: gridRow.co,
        o3: gridRow.o3,
        confidence: gridRow.confidence,
        layer_source: gridRow.layer_source,
        freshness: getFreshness(new Date(gridRow.computed_at)),
        computed_at: gridRow.computed_at,
        region: 'cached',
      };

      // Increment hit_count
      supabase
        .from('aqi_grid')
        .update({ hit_count: (gridRow.hit_count || 0) + 1 })
        .eq('tile_id', tileId)
        .then(() => {});

      // Backfill Redis
      await redisSetEx(redisKey, 900, JSON.stringify(data));

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.setHeader('X-Cache', 'HIT-SUPABASE');
      return res.status(200).json({ data });
    }

    // Step 4: Cache miss → lazy compute via dispersion engine
    const result = await computeDispersion(latitude, longitude);

    const now = new Date().toISOString();
    const data: AQIResponse = {
      tile_id: tileId,
      aqi: result.aqi,
      pm25: result.pm25,
      pm10: result.pm10,
      no2: result.no2,
      co: result.co,
      o3: result.o3,
      confidence: result.confidence,
      layer_source: result.layer_source,
      freshness: 'live',
      computed_at: now,
      region: result.region,
    };

    // Step 5: UPSERT to Supabase (Mode A/B reconciliation built into RPC)
    supabase.rpc('upsert_aqi_tile', {
      p_tile_id: tileId,
      p_lat: latitude,
      p_lon: longitude,
      p_aqi: result.aqi,
      p_pm25: result.pm25,
      p_pm10: result.pm10,
      p_no2: result.no2,
      p_co: result.co,
      p_o3: result.o3,
      p_confidence: result.confidence,
      p_layer_source: result.layer_source,
      p_valid_minutes: 15,
    }).then(() => {});

    // Step 6: Cache in Redis (TTL 900s)
    await redisSetEx(redisKey, 900, JSON.stringify(data));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ data });
  } catch (error) {
    console.error('VAYU AQI error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
