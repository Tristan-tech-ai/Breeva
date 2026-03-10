import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * VAYU Cumulative Exposure Calculator — Self-contained.
 * ERD Section 7.2, 7.3, 7.4
 *
 * Formula: Dose[i] = C[i] × duration[i] × (VR/1000) × IF
 * CE = Σ Dose[i]
 * cigaretteEquivalent = CE / 253
 */

/** Fetch PM2.5 for a single point via Open-Meteo */
async function getPointPM25(lat: number, lon: number): Promise<number> {
  try {
    const resp = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=auto`
    );
    if (!resp.ok) return 15;
    const json = await resp.json();
    return json.current?.pm2_5 ?? 15;
  } catch { return 15; }
}

// Ventilation Rate (L/min) and Intake Fraction per vehicle type (ERD 7.3)
const VEHICLE_PARAMS: Record<string, { vr: number; intakeFraction: number; label: string }> = {
  pedestrian:         { vr: 27.5, intakeFraction: 1.0,  label: 'Pejalan Kaki' },
  cyclist:            { vr: 50.0, intakeFraction: 1.0,  label: 'Pesepeda' },
  motorcycle_open:    { vr: 15.0, intakeFraction: 0.85, label: 'Motor (helm terbuka)' },
  motorcycle_full:    { vr: 15.0, intakeFraction: 0.60, label: 'Motor (helm full-face)' },
  car_window_open:    { vr: 8.0,  intakeFraction: 0.80, label: 'Mobil (jendela buka)' },
  car_ac_recirculate: { vr: 8.0,  intakeFraction: 0.15, label: 'Mobil (AC recirculate)' },
  car_ac_fresh:       { vr: 8.0,  intakeFraction: 0.50, label: 'Mobil (AC fresh air)' },
  public_transport:   { vr: 8.0,  intakeFraction: 0.70, label: 'Angkutan Umum' },
};

// Cigarette dose benchmark: 253 μg PM2.5 per cigarette (ERD 7.4, Berkeley Earth 2015)
const CIGARETTE_DOSE_UG = 253;

type HealthRiskLevel = 'low' | 'moderate' | 'high' | 'very_high';

function classifyRisk(cigaretteEq: number): HealthRiskLevel {
  if (cigaretteEq < 0.5) return 'low';
  if (cigaretteEq < 1.5) return 'moderate';
  if (cigaretteEq < 3.0) return 'high';
  return 'very_high';
}

interface ExposureRequest {
  polyline: [number, number][];
  vehicle_type?: string;
  duration_minutes: number;
}

interface ExposureResponse {
  total_dose_ug: number;
  cigarette_equivalent: number;
  health_risk_level: HealthRiskLevel;
  avg_pm25: number;
  vehicle_type: string;
  vehicle_label: string;
  duration_minutes: number;
  sample_count: number;
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
    samples.push(polyline[Math.round(i * step)]);
  }
  samples.push(polyline[polyline.length - 1]);
  return samples;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as ExposureRequest;
  if (!body.polyline || !Array.isArray(body.polyline) || body.polyline.length < 2) {
    return res.status(400).json({ error: 'polyline required (array of [lat,lon] pairs)' });
  }
  if (!body.duration_minutes || body.duration_minutes <= 0) {
    return res.status(400).json({ error: 'duration_minutes required (positive number)' });
  }
  if (body.polyline.length > 5000) {
    return res.status(400).json({ error: 'polyline too long, max 5000 points' });
  }

  const vehicleType = body.vehicle_type || 'pedestrian';
  const params = VEHICLE_PARAMS[vehicleType] || VEHICLE_PARAMS.pedestrian;

  try {
    // Sample up to 15 points for PM2.5 concentration lookup
    const samples = samplePolyline(body.polyline, 15);

    const results = await Promise.all(
      samples.map(async ([lat, lon]) => ({ pm25: await getPointPM25(lat, lon) }))
    );

    const pm25Values = results.map((r) => r.pm25);
    const avgPM25 = pm25Values.reduce((a, b) => a + b, 0) / pm25Values.length;

    // Duration per segment (even split across samples)
    const durationPerSegment = body.duration_minutes / samples.length;

    // CE = Σ ( C[i] × duration[i] × (VR/1000) × IF )
    let totalDose = 0;
    for (const r of results) {
      const dose = r.pm25 * durationPerSegment * (params.vr / 1000) * params.intakeFraction;
      totalDose += dose;
    }

    const cigaretteEquivalent = totalDose / CIGARETTE_DOSE_UG;

    const data: ExposureResponse = {
      total_dose_ug: Math.round(totalDose * 100) / 100,
      cigarette_equivalent: Math.round(cigaretteEquivalent * 1000) / 1000,
      health_risk_level: classifyRisk(cigaretteEquivalent),
      avg_pm25: Math.round(avgPM25 * 100) / 100,
      vehicle_type: vehicleType,
      vehicle_label: params.label,
      duration_minutes: body.duration_minutes,
      sample_count: samples.length,
    };

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ data });
  } catch (error) {
    console.error('VAYU exposure error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
