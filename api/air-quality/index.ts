import type { VercelRequest, VercelResponse } from '@vercel/node';

// DEPRECATED: This mock endpoint is superseded by /api/vayu/aqi
// Redirects to VAYU Engine for real AQI data.
// Kept for backward compatibility.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { lat, lng } = req.query;
  if (lat && lng) {
    return res.redirect(307, `/api/vayu/aqi?lat=${lat}&lon=${lng}`);
  }
  return res.status(400).json({ error: 'lat and lng query parameters required. Use /api/vayu/aqi instead.' });
}
