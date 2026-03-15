import type { SupabaseClient } from '@supabase/supabase-js';
import { makeAllMerchants } from '../factories/merchantFactory';

export class MerchantSeeder {
  constructor(private sb: SupabaseClient) {}

  async run(): Promise<{ count: number; merchants: Array<{ id: string; category: string }> }> {
    const merchants = makeAllMerchants();
    const inserted: Array<{ id: string; category: string }> = [];

    for (const m of merchants) {
      // Check if merchant already exists by name
      const { data: existing } = await this.sb
        .from('merchants')
        .select('id, category')
        .eq('name', m.name)
        .maybeSingle();

      if (existing) {
        inserted.push({ id: existing.id, category: existing.category });
        console.log(`   ↩ ${m.name} already exists`);
        continue;
      }

      const { data: row, error: rowErr } = await this.sb
        .from('merchants')
        .insert({
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
        })
        .select('id, category')
        .single();

      if (rowErr) {
        console.error(`   ✗ ${m.name}: ${rowErr.message}`);
      } else if (row) {
        inserted.push({ id: row.id, category: row.category });
        console.log(`   + ${m.name}`);
      }
    }

    return { count: inserted.length, merchants: inserted };
  }
}
