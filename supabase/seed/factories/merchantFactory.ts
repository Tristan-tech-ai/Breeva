import { randomFrom, randomBetween, jitter, generateIndonesianPhone, randomFloat } from '../utils/helpers';
import { CITY_LOCATIONS, type City } from '../data/city-locations';
import { ALL_MERCHANT_TEMPLATES, type MerchantTemplate } from '../data/merchant-templates';

export interface MerchantSeedData {
  name: string;
  description: string;
  category: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  website: string | null;
  logo_url: string;
  is_verified: boolean;
  is_active: boolean;
  rating: number;
  review_count: number;
}

// Distribute templates across cities
const CITY_COUNTS: Record<City, number> = {
  jakarta: 12,
  bali: 10,
  bandung: 5,
  surabaya: 3,
};

export function makeAllMerchants(): MerchantSeedData[] {
  const merchants: MerchantSeedData[] = [];
  // Work from a copy of templates so we can pick without repeating
  const pool = [...ALL_MERCHANT_TEMPLATES];

  for (const [city, count] of Object.entries(CITY_COUNTS) as [City, number][]) {
    const locations = CITY_LOCATIONS[city];
    for (let i = 0; i < count; i++) {
      // Pick a template (cycle through pool)
      const templateIdx = (merchants.length) % pool.length;
      const template = pool[templateIdx];
      const loc = locations[i % locations.length];

      merchants.push({
        name: template.name,
        description: template.description,
        category: template.category,
        address: loc.address,
        city,
        lat: jitter(loc.lat),
        lng: jitter(loc.lng),
        phone: generateIndonesianPhone(),
        website: null,
        logo_url: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(template.name)}`,
        is_verified: Math.random() > 0.2,
        is_active: true,
        rating: randomFloat(3.8, 5.0, 1),
        review_count: randomBetween(5, 120),
      });
    }
  }

  return merchants;
}
