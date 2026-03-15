import { randomBetween, randomFrom, randomTimestamp, jitter, randomFloat } from '../utils/helpers';
import { CITY_LOCATIONS, type City } from '../data/city-locations';
import { AQ_DESCRIPTIONS } from '../data/walk-routes';

export interface ReportSeedData {
  user_id: string;
  lat: number;
  lng: number;
  aqi_rating: number;
  description: string;
  photo_url: null;
  confidence_score: number;
  created_at: string;
}

/**
 * Generate `count` air quality reports for a user in a given city.
 */
export function makeReportsForUser(
  userId: string,
  city: City,
  count: number,
  daysBack = 30,
): ReportSeedData[] {
  const locations = CITY_LOCATIONS[city];
  const descriptions = AQ_DESCRIPTIONS[city];

  const aqiRange: Record<City, [number, number]> = {
    jakarta: [3, 5],
    bali: [1, 3],
    bandung: [2, 4],
    surabaya: [2, 4],
  };
  const [minAqi, maxAqi] = aqiRange[city];

  const reports: ReportSeedData[] = [];
  for (let i = 0; i < count; i++) {
    const loc = randomFrom(locations);
    reports.push({
      user_id: userId,
      lat: jitter(loc.lat),
      lng: jitter(loc.lng),
      aqi_rating: randomBetween(minAqi, maxAqi),
      description: randomFrom(descriptions),
      photo_url: null,
      confidence_score: randomFloat(0.6, 1.0, 2),
      created_at: randomTimestamp(-daysBack, 0),
    });
  }
  return reports;
}
