import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Grid-AQI Endpoint — Returns gridded air quality for heatmap overlay.
 * Used by AQIHeatmapLayer at z < 11 (area overview, eLichens screenshot #8 style).
 *
 * GET /api/vayu/grid-aqi?south=&west=&north=&east=&res=6&pollutant=aqi
 *
 * Open-Meteo supports batch lat/lon → single API call for entire grid.
 */

// ─── Redis helpers ──────────────────────────────────────────
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
  } catch { return null; }
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

// ─── PM2.5 → US EPA AQI ────────────────────────────────────
function pm25ToAQI(pm25: number): number {
  const bp = [
    [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
  ];
  const c = Math.max(0, Math.min(pm25, 500.4));
  for (const [lo, hi, aqiLo, aqiHi] of bp) {
    if (c <= hi) return Math.round(((aqiHi - aqiLo) / (hi - lo)) * (c - lo) + aqiLo);
  }
  return 500;
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { south, west, north, east, res: resolution, pollutant } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(400).json({ error: 'south, west, north, east required' });
  }

  const s = parseFloat(south as string);
  const w = parseFloat(west as string);
  const n = parseFloat(north as string);
  const e = parseFloat(east as string);
  const gridRes = Math.max(3, Math.min(14, parseInt(resolution as string) || 6));
  const poll = (pollutant as string) || 'aqi';

  if ([s, w, n, e].some(isNaN) || s > n || w > e) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }

  // Limit bbox span (max 180° for global views, padded)
  if (n - s > 180 || e - w > 360) {
    return res.status(400).json({ error: 'Bounding box too large' });
  }

  try {
    // Cache key (quantize to 2° grid for dedup — coarser = more hits)
    const q = (v: number) => (Math.round(v / 2) * 2).toFixed(0);
    const cacheKey = `vayu:grid:${q(s)}:${q(w)}:${q(n)}:${q(e)}:r${gridRes}`;

    const cached = await redisGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(JSON.parse(cached));
    }

    // Generate grid coordinates
    const latStep = (n - s) / Math.max(1, gridRes - 1);
    const lonStep = (e - w) / Math.max(1, gridRes - 1);
    const lats: number[] = [];
    const lons: number[] = [];

    for (let row = 0; row < gridRes; row++) {
      for (let col = 0; col < gridRes; col++) {
        lats.push(Math.round((s + row * latStep) * 100) / 100);
        lons.push(Math.round((w + col * lonStep) * 100) / 100);
      }
    }

    // Open-Meteo batch: comma-separated coordinates in single request
    const latParam = lats.join(',');
    const lonParam = lons.join(',');
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latParam}&longitude=${lonParam}&current=pm2_5,pm10,nitrogen_dioxide,ozone&timezone=auto`;

    const aqResp = await fetch(aqUrl);
    if (!aqResp.ok) {
      return res.status(502).json({ error: 'Open-Meteo API error' });
    }
    const aqData = await aqResp.json();

    // Parse response: single location = object, multiple = array
    const entries = Array.isArray(aqData) ? aqData : [aqData];

    const grid: number[] = entries.map((entry: { current?: { pm2_5?: number; pm10?: number; nitrogen_dioxide?: number; ozone?: number } }) => {
      const c = entry.current;
      const pm25 = c?.pm2_5 ?? 15;
      const pm10 = c?.pm10 ?? 25;
      const no2 = c?.nitrogen_dioxide ?? 10;
      const o3 = c?.ozone ?? 30;

      switch (poll) {
        case 'pm25': return pm25;
        case 'no2': return no2;
        case 'o3': return o3;
        case 'pm10': return pm10;
        default: return pm25ToAQI(pm25);
      }
    });

    const result = {
      grid,
      rows: gridRes,
      cols: gridRes,
      bounds: { south: s, west: w, north: n, east: e },
      pollutant: poll,
      computed_at: new Date().toISOString(),
    };

    // Cache 60 min (low-zoom data changes slowly)
    await redisSetEx(cacheKey, 3600, JSON.stringify(result));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);

  } catch (error) {
    console.error('VAYU grid-aqi error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
