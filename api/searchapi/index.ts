import type { VercelRequest, VercelResponse } from '@vercel/node';

const SEARCHAPI_KEY = (process.env.SEARCHAPI_KEY || '').trim();
const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';

// Allowed engines to prevent abuse
const ALLOWED_ENGINES = new Set([
  'google_maps',
  'google_maps_place',
  'google_maps_reviews',
  'google_maps_photos',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SEARCHAPI_KEY) {
    return res.status(500).json({ error: 'SearchAPI key not configured' });
  }

  const { engine, ...params } = req.query;

  if (!engine || typeof engine !== 'string' || !ALLOWED_ENGINES.has(engine)) {
    return res.status(400).json({ error: 'Invalid or missing engine parameter' });
  }

  try {
    const url = new URL(SEARCHAPI_BASE);
    url.searchParams.set('api_key', SEARCHAPI_KEY);
    url.searchParams.set('engine', engine);

    // Forward allowed query params
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && key !== 'api_key') {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `SearchAPI error: ${response.status}`, details: text });
    }

    const data = await response.json();

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('SearchAPI proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
