import { randomBetween, randomFrom, randomTimestamp } from '../utils/helpers';
import { WALK_ROUTES } from '../data/walk-routes';
import type { City } from '../data/city-locations';

export interface WalkSeedData {
  user_id: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  distance_meters: number;
  duration_seconds: number;
  ecopoints_earned: number;
  co2_saved_grams: number;
  avg_aqi: number;
  route_type: string;
  status: string;
  started_at: string;
  completed_at: string;
  is_verified: boolean;
}

/**
 * Generate `count` walks for a user in a given city, spread over [daysBack, 0] days.
 */
export function makeWalksForUser(
  userId: string,
  city: City,
  count: number,
  daysBack: number,
): WalkSeedData[] {
  const cityRoutes = WALK_ROUTES[city];
  if (!cityRoutes || cityRoutes.length === 0) return [];

  const walks: WalkSeedData[] = [];

  for (let i = 0; i < count; i++) {
    const route = randomFrom(cityRoutes);
    const distVariance = randomBetween(-200, 200);
    const distanceMeters = Math.max(300, route.distance + distVariance);
    // ~4.3 km/h average walk → ~0.00072 km/s → 1.39 m/s
    const durationSeconds = Math.round(distanceMeters / 1.2) + randomBetween(-60, 120);
    const ecopoints = Math.max(1, Math.round(distanceMeters / 100));
    const co2 = Math.round(distanceMeters * 0.12);
    const aqi = randomBetween(route.aqiMin, route.aqiMax);

    // Random time within the daysBack window; add hour offset for time-of-day variety
    const dayOffset = -Math.floor((daysBack / count) * i + randomBetween(0, 2));
    const hourOffset = randomBetween(5, 20); // walks happen between 5am–8pm
    const started = new Date(
      Date.now() + dayOffset * 86_400_000 + hourOffset * 3_600_000,
    );
    const completed = new Date(started.getTime() + durationSeconds * 1000);

    walks.push({
      user_id: userId,
      origin_address: route.origin.address,
      origin_lat: route.origin.lat,
      origin_lng: route.origin.lng,
      destination_address: route.destination.address,
      destination_lat: route.destination.lat,
      destination_lng: route.destination.lng,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      ecopoints_earned: ecopoints,
      co2_saved_grams: co2,
      avg_aqi: aqi,
      route_type: randomFrom(['eco', 'eco', 'eco', 'scenic', 'shortest']),
      status: 'completed',
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      is_verified: true,
    });
  }

  return walks;
}
