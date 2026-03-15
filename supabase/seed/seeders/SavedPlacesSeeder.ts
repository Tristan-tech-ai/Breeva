import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSeedData } from '../factories/userFactory';

/** Pre-populated saved places for demo account (Jakarta landmarks) */
const DEMO_SAVED_PLACES = [
  { name: 'Monas', address: 'Jl. Medan Merdeka Barat, Jakarta Pusat', lat: -6.1754, lng: 106.8272, category: 'landmark' },
  { name: 'Kota Tua Jakarta', address: 'Jl. Taman Fatahillah No.1, Jakarta Barat', lat: -6.1352, lng: 106.8133, category: 'landmark' },
  { name: 'GBK Senayan', address: 'Jl. Pintu Satu Senayan, Jakarta Selatan', lat: -6.2185, lng: 106.8020, category: 'exercise' },
  { name: 'Taman Menteng', address: 'Jl. HOS. Cokroaminoto, Menteng', lat: -6.1963, lng: 106.8380, category: 'park' },
  { name: 'Kantor', address: 'Jl. Sudirman No.52, SCBD', lat: -6.2249, lng: 106.8097, category: 'work' },
  { name: 'Rumah', address: 'Jl. Kemang Raya No.10', lat: -6.2607, lng: 106.8142, category: 'home' },
  { name: 'Hutan Kota GBK', address: 'Senayan, Jakarta', lat: -6.2170, lng: 106.7995, category: 'park' },
  { name: 'Cafe Eco Senopati', address: 'Jl. Senopati No.88', lat: -6.2310, lng: 106.8040, category: 'food' },
];

export class SavedPlacesSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      // Only seed saved places for demo and power users
      if (userData.role !== 'demo' && userData.tier !== 'power') continue;

      const places = userData.role === 'demo'
        ? DEMO_SAVED_PLACES
        : DEMO_SAVED_PLACES.slice(0, 3); // Power users get a few

      for (const place of places) {
        const { error } = await this.sb.from('saved_places').upsert(
          {
            user_id: userId,
            name: place.name,
            address: place.address,
            latitude: place.lat,
            longitude: place.lng,
            category: place.category,
          },
          { onConflict: 'id' },
        );

        if (error) {
          console.error(`   ✗ Saved place "${place.name}" for ${userData.email}: ${error.message}`);
        } else {
          total++;
        }
      }
    }

    console.log(`   + Inserted ${total} saved places`);
    return { count: total };
  }
}
