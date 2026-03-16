import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserSeedData } from '../factories/userFactory';

/** Diverse saved places across Jakarta for realistic demo data */
const ALL_SAVED_PLACES = [
  // Landmarks
  { name: 'Monas', address: 'Jl. Medan Merdeka Barat, Jakarta Pusat', lat: -6.1754, lng: 106.8272, category: 'landmark' },
  { name: 'Kota Tua Jakarta', address: 'Jl. Taman Fatahillah No.1, Jakarta Barat', lat: -6.1352, lng: 106.8133, category: 'landmark' },
  { name: 'Istiqlal Mosque', address: 'Jl. Taman Wijaya Kusuma, Jakarta Pusat', lat: -6.1700, lng: 106.8310, category: 'mosque' },
  { name: 'Jakarta Cathedral', address: 'Jl. Katedral No.7B, Jakarta Pusat', lat: -6.1694, lng: 106.8326, category: 'church' },

  // Parks
  { name: 'Taman Menteng', address: 'Jl. HOS. Cokroaminoto, Menteng', lat: -6.1963, lng: 106.8380, category: 'park' },
  { name: 'Hutan Kota GBK', address: 'Senayan, Jakarta Selatan', lat: -6.2170, lng: 106.7995, category: 'park' },
  { name: 'Taman Suropati', address: 'Jl. Taman Suropati, Menteng', lat: -6.1985, lng: 106.8408, category: 'park' },
  { name: 'Taman Langsat', address: 'Jl. Langsat, Kebayoran Baru', lat: -6.2460, lng: 106.7914, category: 'park' },

  // Home & Work
  { name: 'Kantor', address: 'Jl. Sudirman No.52, SCBD', lat: -6.2249, lng: 106.8097, category: 'work' },
  { name: 'Rumah', address: 'Jl. Kemang Raya No.10', lat: -6.2607, lng: 106.8142, category: 'home' },

  // Food & Cafe
  { name: 'Cafe Eco Senopati', address: 'Jl. Senopati No.88', lat: -6.2310, lng: 106.8040, category: 'cafe' },
  { name: 'Warung Nasi Padang Sederhana', address: 'Jl. H. Agus Salim No.29, Menteng', lat: -6.1920, lng: 106.8330, category: 'food' },
  { name: 'Kopi Kenangan Sudirman', address: 'Jl. Jend. Sudirman, Jakarta', lat: -6.2100, lng: 106.8185, category: 'cafe' },
  { name: 'Sate Khas Senayan', address: 'Jl. Kebon Sirih No.31, Jakarta Pusat', lat: -6.1850, lng: 106.8310, category: 'food' },

  // Gym & Sports
  { name: 'GBK Senayan', address: 'Jl. Pintu Satu Senayan, Jakarta Selatan', lat: -6.2185, lng: 106.8020, category: 'gym' },
  { name: 'Celebrity Fitness Pacific Place', address: 'Pacific Place, SCBD', lat: -6.2245, lng: 106.8098, category: 'gym' },

  // Schools & Education
  { name: 'Universitas Indonesia', address: 'Kampus UI Depok', lat: -6.3612, lng: 106.8312, category: 'school' },
  { name: 'SMA Negeri 8 Jakarta', address: 'Jl. Taman Bukit Duri No.2', lat: -6.2250, lng: 106.8580, category: 'school' },

  // Hospitals
  { name: 'RS Medistra', address: 'Jl. Jend. Gatot Subroto Kav. 59, Jakarta Selatan', lat: -6.2310, lng: 106.8290, category: 'hospital' },
  { name: 'RSCM', address: 'Jl. Diponegoro No.71, Jakarta Pusat', lat: -6.1978, lng: 106.8465, category: 'hospital' },

  // Shopping
  { name: 'Grand Indonesia', address: 'Jl. M.H. Thamrin No.1, Jakarta Pusat', lat: -6.1952, lng: 106.8210, category: 'shop' },
  { name: 'Plaza Indonesia', address: 'Jl. M.H. Thamrin Kav 28-30', lat: -6.1935, lng: 106.8225, category: 'shop' },
  { name: 'Pasar Santa', address: 'Jl. Cipaku 1, Kebayoran Baru', lat: -6.2420, lng: 106.8050, category: 'shop' },

  // Hotels
  { name: 'Hotel Mulia Senayan', address: 'Jl. Asia Afrika Senayan, Jakarta', lat: -6.2157, lng: 106.7985, category: 'hotel' },
  { name: 'The Ritz-Carlton Jakarta', address: 'Jl. DR. Ide Anak Agung Gde Agung', lat: -6.2280, lng: 106.8180, category: 'hotel' },

  // Transport
  { name: 'Stasiun Sudirman', address: 'Jl. Jend. Sudirman, Jakarta Pusat', lat: -6.2020, lng: 106.8230, category: 'transport' },
  { name: 'Halte TransJakarta Bundaran HI', address: 'Bundaran HI, Jakarta Pusat', lat: -6.1950, lng: 106.8230, category: 'transport' },

  // Favorites
  { name: 'Spot Sunset Ancol', address: 'Jl. Lodan Timur No.7, Ancol', lat: -6.1262, lng: 106.8311, category: 'favorite' },
  { name: 'Track Lari Monas', address: 'Area Monas, Jakarta Pusat', lat: -6.1760, lng: 106.8270, category: 'favorite' },
];

/** Per-tier: how many saved places to assign */
const TIER_PLACE_COUNT: Record<string, number> = {
  power: 12,
  active: 8,
  casual: 4,
  new: 2,
  dormant: 3,
};

export class SavedPlacesSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(userMap: Map<string, UserSeedData>): Promise<{ count: number }> {
    let total = 0;

    for (const [userId, userData] of userMap) {
      const count = userData.role === 'demo'
        ? ALL_SAVED_PLACES.length
        : TIER_PLACE_COUNT[userData.tier] ?? 3;

      // Demo gets all, others get a random subset always including home & work
      let places: typeof ALL_SAVED_PLACES;
      if (userData.role === 'demo') {
        places = ALL_SAVED_PLACES;
      } else {
        const essentials = ALL_SAVED_PLACES.filter((p) => p.category === 'home' || p.category === 'work');
        const others = ALL_SAVED_PLACES.filter((p) => p.category !== 'home' && p.category !== 'work');
        const shuffled = others.sort(() => Math.random() - 0.5);
        places = [...essentials, ...shuffled.slice(0, Math.max(0, count - essentials.length))];
      }

      const rows = places.map((place) => ({
        user_id: userId,
        name: place.name,
        address: place.address,
        latitude: place.lat,
        longitude: place.lng,
        category: place.category,
      }));

      const { error } = await this.sb.from('saved_places').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

      if (error) {
        console.error(`   ✗ Saved places for ${userData.email}: ${error.message}`);
      } else {
        total += rows.length;
      }
    }

    console.log(`   + Inserted ${total} saved places`);
    return { count: total };
  }
}
