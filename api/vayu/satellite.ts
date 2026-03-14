import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Satellite Endpoint — Sentinel-5P TROPOMI NO₂ column density.
 * Fetches satellite-derived NO₂ data from Copernicus Data Space Processing API.
 *
 * GET /api/vayu/satellite?south=&west=&north=&east=
 *
 * Requires env vars: COPERNICUS_CLIENT_ID, COPERNICUS_CLIENT_SECRET
 * Gracefully returns empty when credentials not configured.
 *
 * Data: S5P L2 tropospheric NO₂ column at ~3.5km resolution, daily revisit.
 * Cached 12h in Redis (satellite data updates once per day ~13:30 local).
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

// ─── Copernicus OAuth2 token ────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

let cachedToken: { token: string; expiry: number } | null = null;

async function getCopernicusToken(): Promise<string | null> {
  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Reuse token if still valid (with 60s margin)
  if (cachedToken && Date.now() < cachedToken.expiry - 60000) {
    return cachedToken.token;
  }

  try {
    const resp = await fetch(
      'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );
    if (!resp.ok) return null;
    const data: TokenResponse = await resp.json();
    cachedToken = {
      token: data.access_token,
      expiry: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

// ─── Sentinel Hub Process API: S5P NO₂ ─────────────────────

interface SatelliteGrid {
  grid: number[];     // NO₂ tropospheric column in µmol/m²
  rows: number;
  cols: number;
  bounds: { south: number; west: number; north: number; east: number };
  source: 'sentinel-5p' | 'fallback';
  date: string;
}

// Evalscript extracts tropospheric NO₂ column density from S5P L2
const EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["NO2", "dataMask"],
      units: "DN"
    }],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [NaN];
  // NO2 tropospheric column in mol/m², convert to µmol/m²
  return [sample.NO2 * 1e6];
}
`;

async function fetchSentinel5PData(
  south: number, west: number, north: number, east: number,
  token: string,
): Promise<SatelliteGrid | null> {
  // Date range: last 3 days (S5P revisit ~daily, but cloud gaps)
  const to = new Date();
  const from = new Date(to.getTime() - 3 * 24 * 60 * 60 * 1000);

  // Request a small raster grid (10x10 = 100 pixels gives ~3.5km per pixel for typical viewport)
  const width = 10;
  const height = 10;

  const body = {
    input: {
      bounds: {
        bbox: [west, south, east, north],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{
        type: 'sentinel-5p-l2',
        dataFilter: {
          timeRange: {
            from: from.toISOString(),
            to: to.toISOString(),
          },
          mosaickingOrder: 'mostRecent',
        },
      }],
    },
    output: {
      width,
      height,
      responses: [{
        identifier: 'default',
        format: { type: 'image/tiff' },
      }],
    },
    evalscript: EVALSCRIPT,
  };

  try {
    const resp = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      // If SH fails, try a JSON-based statistical approach
      return await fetchSentinel5PStats(south, west, north, east, token, from, to);
    }

    // Parse TIFF response — extract raw float32 pixel values
    const buffer = await resp.arrayBuffer();
    const float32View = new Float32Array(buffer, buffer.byteLength - width * height * 4, width * height);
    const grid: number[] = [];
    for (let i = 0; i < float32View.length; i++) {
      const val = float32View[i];
      grid.push(isNaN(val) || val <= 0 ? -1 : val); // -1 = no data (cloud/gap)
    }

    return {
      grid,
      rows: height,
      cols: width,
      bounds: { south, west, north, east },
      source: 'sentinel-5p',
      date: to.toISOString().split('T')[0],
    };
  } catch {
    return null;
  }
}

// ─── Fallback: Statistical API for S5P data ─────────────────

async function fetchSentinel5PStats(
  south: number, west: number, north: number, east: number,
  token: string, from: Date, to: Date,
): Promise<SatelliteGrid | null> {
  // Use the statistical API to get mean NO₂ for sub-regions
  const rows = 5;
  const cols = 5;
  const latStep = (north - south) / rows;
  const lonStep = (east - west) / cols;

  const grid: number[] = [];

  // Query each sub-cell for statistical NO₂ value
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellS = south + r * latStep;
      const cellW = west + c * lonStep;
      const cellN = cellS + latStep;
      const cellE = cellW + lonStep;

      try {
        const body = {
          input: {
            bounds: {
              bbox: [cellW, cellS, cellE, cellN],
              properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
            },
            data: [{
              type: 'sentinel-5p-l2',
              dataFilter: {
                timeRange: { from: from.toISOString(), to: to.toISOString() },
                mosaickingOrder: 'mostRecent',
              },
            }],
          },
          aggregation: {
            timeRange: { from: from.toISOString(), to: to.toISOString() },
            aggregationInterval: { of: 'P3D' },
            evalscript: EVALSCRIPT,
            width: 1,
            height: 1,
          },
        };

        const resp = await fetch('https://sh.dataspace.copernicus.eu/api/v1/statistics', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (resp.ok) {
          const stats = await resp.json();
          const mean = stats?.data?.[0]?.outputs?.default?.bands?.B0?.stats?.mean;
          grid.push(mean != null && mean > 0 ? mean : -1);
        } else {
          grid.push(-1);
        }
      } catch {
        grid.push(-1);
      }
    }
  }

  // Check if we got any valid data
  const validCount = grid.filter((v) => v > 0).length;
  if (validCount === 0) return null;

  return {
    grid,
    rows,
    cols,
    bounds: { south, west, north, east },
    source: 'sentinel-5p',
    date: to.toISOString().split('T')[0],
  };
}

// ─── Handler ────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { south, west, north, east } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(400).json({ error: 'south, west, north, east required' });
  }

  const s = parseFloat(south as string);
  const w = parseFloat(west as string);
  const n = parseFloat(north as string);
  const e = parseFloat(east as string);

  if ([s, w, n, e].some(isNaN) || s > n || w > e) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }

  // Check for Copernicus credentials
  const token = await getCopernicusToken();
  if (!token) {
    return res.status(200).json({
      available: false,
      reason: 'Copernicus Data Space credentials not configured (COPERNICUS_CLIENT_ID, COPERNICUS_CLIENT_SECRET)',
      grid: null,
    });
  }

  try {
    // Cache key (quantize to ~0.1° for dedup)
    const q = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
    const cacheKey = `vayu:sat:${q(s)}:${q(w)}:${q(n)}:${q(e)}`;

    const cached = await redisGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ available: true, ...JSON.parse(cached) });
    }

    const data = await fetchSentinel5PData(s, w, n, e, token);

    if (!data) {
      return res.status(200).json({
        available: false,
        reason: 'No Sentinel-5P data available for this region/timeframe',
        grid: null,
      });
    }

    // Cache 12 hours (S5P revisit ~daily)
    await redisSetEx(cacheKey, 43200, JSON.stringify(data));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ available: true, ...data });

  } catch (error) {
    console.error('VAYU satellite error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Internal server error', detail: message });
  }
}
