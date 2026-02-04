import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase environment variables. Please check your .env.local file.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

// Auth helpers
export const auth = {
  /**
   * Sign in with Google OAuth
   */
  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    return { data, error };
  },

  /**
   * Sign out current user
   */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  /**
   * Get current session
   */
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    return { session: data.session, error };
  },

  /**
   * Get current user
   */
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    return { user: data.user, error };
  },

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};

// Database helpers
export const db = {
  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    return { data, error };
  },

  /**
   * Update user profile
   */
  async updateUserProfile(userId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from('users')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    return { data, error };
  },

  /**
   * Get user's walk history
   */
  async getWalkHistory(userId: string, limit = 10, offset = 0) {
    const { data, error, count } = await supabase
      .from('walk_sessions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return { data, error, count };
  },

  /**
   * Get user's EcoPoints transactions
   */
  async getEcoPointsHistory(userId: string, limit = 20) {
    const { data, error } = await supabase
      .from('eco_points_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error };
  },

  /**
   * Get available rewards
   */
  async getRewards(category?: string) {
    let query = supabase
      .from('rewards')
      .select('*, merchant:merchants(*)')
      .eq('is_active', true)
      .gt('stock', 0)
      .gt('valid_until', new Date().toISOString());

    if (category) {
      query = query.eq('merchants.category', category);
    }

    const { data, error } = await query.order('points_required', { ascending: true });
    return { data, error };
  },

  /**
   * Get nearby merchants
   */
  async getNearbyMerchants(lat: number, lng: number, radiusKm = 5) {
    // Using PostGIS for geospatial query
    const { data, error } = await supabase.rpc('get_nearby_merchants', {
      user_lat: lat,
      user_lng: lng,
      radius_km: radiusKm,
    });
    return { data, error };
  },
};

export default supabase;
