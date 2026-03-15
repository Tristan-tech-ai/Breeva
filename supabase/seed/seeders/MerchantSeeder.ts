import type { SupabaseClient } from '@supabase/supabase-js';
import { makeAllMerchants } from '../factories/merchantFactory';

export class MerchantSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(): Promise<{ count: number; merchants: Array<{ id: string; category: string }> }> {
    const merchants = makeAllMerchants();
    const inserted: Array<{ id: string; category: string }> = [];

    // Batch insert all merchants
    const { data, error } = await this.sb
      .from('merchants')
      .upsert(
        merchants.map((m) => ({
          name: m.name,
          description: m.description,
          category: m.category,
          logo_url: m.logo_url,
          address: m.address,
          lat: m.lat,
          lng: m.lng,
          phone: m.phone,
          rating: m.rating,
          review_count: m.review_count,
          is_verified: m.is_verified,
          is_active: m.is_active,
        })),
        { onConflict: 'name' }
      )
      .select('id, category');

    if (error) {
      console.error(`   ✗ Merchant upsert failed: ${error.message}`);

      // Fallback: insert one by one
      for (const m of merchants) {
        const { data: row, error: rowErr } = await this.sb
          .from('merchants')
          .upsert(
            {
              name: m.name,
              description: m.description,
              category: m.category,
              logo_url: m.logo_url,
              address: m.address,
              lat: m.lat,
              lng: m.lng,
              phone: m.phone,
              rating: m.rating,
              review_count: m.review_count,
              is_verified: m.is_verified,
              is_active: m.is_active,
            },
            { onConflict: 'name' }
          )
          .select('id, category')
          .single();

        if (rowErr) {
          console.error(`   ✗ ${m.name}: ${rowErr.message}`);
        } else if (row) {
          inserted.push({ id: row.id, category: row.category });
          console.log(`   + ${m.name}`);
        }
      }
    } else if (data) {
      for (const row of data) {
        inserted.push({ id: row.id, category: row.category });
      }
      console.log(`   + Inserted ${data.length} merchants`);
    }

    return { count: inserted.length, merchants: inserted };
  }
}
