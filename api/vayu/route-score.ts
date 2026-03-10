import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Route Score Endpoint — Self-contained.
 * Calls Open-Meteo directly for AQI per sample point (no cross-dir imports).
 */

// Vehicle routing weights (ERD 9.2)
const VEHICLE_WEIGHTS: Record<string, { aqi: number; time: number }> = {
  pedestrian:  { aqi: 0.70, time: 0.30 },
  bicycle:     { aqi: 0.60, time: 0.40 },
  motorcycle:  { aqi: 0.50, time: 0.50 },
  car:         { aqi: 0.40, time: 0.60 },
  public:      { aqi: 0.30, time: 0.70 },
};

function pm25ToAQI(pm25: number): number {
  const bp = [
    [0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
  ];
  const c = Math.max(0, Math.min(pm25, 500.4));
  for (const [lo, hi, aqiLo, aqiHi] of bp) {
    if (c <= hi) return Math.round(((aqiHi - aqiLo) / (hi - lo)) * (c - lo) + aqiLo);
  }
  return 500;
}

/** Fetch AQI for a single point via Open-Meteo (lightweight, no import chain) */
async function getPointAQI(lat: number, lon: number): Promise<{ aqi: number; pm25: number }> {
  try {
    const resp = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=auto`
    );
    if (!resp.ok) return { aqi: 50, pm25: 12 };
    const json = await resp.json();
    const pm25 = json.current?.pm2_5 ?? 12;
    return { aqi: pm25ToAQI(pm25), pm25 };
  } catch {
    return { aqi: 50, pm25: 12 };
  }
}

interface RouteScoreRequest {
  polyline: [number, number][];  // [lat, lon] pairs
  vehicle_type?: string;
  duration_seconds?: number;
}

interface SegmentScore {
  lat: number;
  lon: number;
  aqi: number;
  pm25: number;
}

interface RouteScoreResponse {
  avg_aqi: number;
  max_aqi: number;
  min_aqi: number;
  combined_score: number;
  vehicle_type: string;
  sample_count: number;
  segments: SegmentScore[];
}

/** Sample N equidistant points from a polyline */
function samplePolyline(
  polyline: [number, number][],
  maxSamples: number
): [number, number][] {
  if (polyline.length <= maxSamples) return polyline;

  const samples: [number, number][] = [polyline[0]];
  const step = (polyline.length - 1) / (maxSamples - 1);
  for (let i = 1; i < maxSamples - 1; i++) {
    const idx = Math.round(i * step);
    samples.push(polyline[idx]);
  }
  samples.push(polyline[polyline.length - 1]);
  return samples;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as RouteScoreRequest;
  if (!body.polyline || !Array.isArray(body.polyline) || body.polyline.length < 2) {
    return res.status(400).json({ error: 'polyline (array of [lat,lon] pairs) required, min 2 points' });
  }

  // Cap polyline length for safety
  if (body.polyline.length > 5000) {
    return res.status(400).json({ error: 'polyline too long, max 5000 points' });
  }

  const vehicleType = body.vehicle_type || 'pedestrian';
  const weights = VEHICLE_WEIGHTS[vehicleType] || VEHICLE_WEIGHTS.pedestrian;

  try {
    // Sample up to 20 points along the route for AQI evaluation
    const samples = samplePolyline(body.polyline, 20);

    // Batch AQI compute for each sample point (parallel)
    const results = await Promise.all(
      samples.map(async ([lat, lon]) => {
        const r = await getPointAQI(lat, lon);
        return { lat, lon, aqi: r.aqi, pm25: r.pm25 };
      })
    );

    const aqiValues = results.map((r) => r.aqi);
    const avgAqi = aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length;
    const maxAqi = Math.max(...aqiValues);
    const minAqi = Math.min(...aqiValues);

    // AQI score normalized (0-1)
    const aqiScore = avgAqi / 500;

    // Time score: use duration if provided, otherwise route length heuristic
    const durationSec = body.duration_seconds || (body.polyline.length * 5); // rough estimate
    const timeScore = Math.min(durationSec / 3600, 1.0); // normalize to 1hr max

    const combinedScore = weights.aqi * aqiScore + weights.time * timeScore;

    const data: RouteScoreResponse = {
      avg_aqi: Math.round(avgAqi),
      max_aqi: maxAqi,
      min_aqi: minAqi,
      combined_score: Math.round(combinedScore * 1000) / 1000,
      vehicle_type: vehicleType,
      sample_count: samples.length,
      segments: results,
    };

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ data });
  } catch (error) {
    console.error('VAYU route-score error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
