import type { VercelRequest, VercelResponse } from '@vercel/node';

const ORS_API_KEY = process.env.VITE_OPENROUTESERVICE_API_KEY || '';
const ORS_BASE_URL = 'https://api.openrouteservice.org';

interface Coordinate {
  lat: number;
  lng: number;
}

interface RouteRequest {
  start: Coordinate;
  end: Coordinate;
  profile?: 'foot-walking' | 'foot-hiking';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { start, end, profile = 'foot-walking' }: RouteRequest = req.body;

    if (!start || !end || !start.lat || !start.lng || !end.lat || !end.lng) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const coordinates = [
      [start.lng, start.lat],
      [end.lng, end.lat],
    ];

    const response = await fetch(`${ORS_BASE_URL}/v2/directions/${profile}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates,
        format: 'geojson',
        instructions: true,
        units: 'm',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ORS API error:', response.status, errorText);
      return res.status(response.status).json({ error: 'Route calculation failed' });
    }

    const data = await response.json();
    const feature = data.features[0];
    const properties = feature.properties;
    const geometry = feature.geometry;

    // Transform response
    const route = {
      distance_meters: properties.summary.distance,
      duration_seconds: properties.summary.duration,
      coordinates: geometry.coordinates.map((coord: number[]) => ({
        lng: coord[0],
        lat: coord[1],
      })),
      instructions: properties.segments[0]?.steps || [],
    };

    return res.status(200).json({ route });
  } catch (error) {
    console.error('Route calculation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
