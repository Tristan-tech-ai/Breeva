import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    '❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    '   Set them in .env.local or as environment variables.'
  );
  process.exit(1);
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
