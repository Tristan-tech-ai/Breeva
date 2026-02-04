import type { VercelRequest, VercelResponse } from '@vercel/node';

// Mock AQI data for now - in production, integrate with real AQI API
// Options: OpenWeatherMap Air Pollution API, AQICN API, IQAir API

interface AQIRequest {
  lat: number;
  lng: number;
}

interface AQIData {
  aqi: number;
  level: string;
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  timestamp: string;
}

function getAQILevel(aqi: number): string {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy-sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lat, lng } = req.method === 'GET' ? req.query : req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // For MVP, generate realistic mock data based on location
    // Jakarta area tends to have higher pollution
    const isJakarta = latitude >= -6.5 && latitude <= -6.0 && longitude >= 106.5 && longitude <= 107.0;
    const isBali = latitude >= -8.8 && latitude <= -8.0 && longitude >= 114.5 && longitude <= 115.5;

    let baseAQI: number;
    if (isJakarta) {
      baseAQI = 80 + Math.floor(Math.random() * 70); // 80-150
    } else if (isBali) {
      baseAQI = 30 + Math.floor(Math.random() * 40); // 30-70
    } else {
      baseAQI = 40 + Math.floor(Math.random() * 60); // 40-100
    }

    // Add some time-based variation (worse during rush hours)
    const hour = new Date().getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      baseAQI += Math.floor(Math.random() * 20);
    }

    const aqi = Math.min(baseAQI, 300);

    const data: AQIData = {
      aqi,
      level: getAQILevel(aqi),
      pm25: aqi * 0.5 + Math.random() * 10,
      pm10: aqi * 0.8 + Math.random() * 15,
      o3: aqi * 0.3 + Math.random() * 5,
      no2: aqi * 0.2 + Math.random() * 5,
      timestamp: new Date().toISOString(),
    };

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    
    return res.status(200).json({ data });
  } catch (error) {
    console.error('Air quality API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
