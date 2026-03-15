import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  ecopoints_balance: number;
  total_distance_km: number;
  total_walks: number;
  total_co2_saved_grams: number;
  current_streak: number;
  longest_streak: number;
  last_walk_date: string | null;
  subscription_tier: string;
  created_at: string;
  updated_at: string;
  onboarding_completed?: boolean;
}

interface AuthState {
  // State
  user: SupabaseUser | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  setUser: (user: SupabaseUser | null) => void;
  setSession: (session: Session | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;

  // Auth actions
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  initialize: () => Promise<void>;
  completeOnboarding: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      session: null,
      profile: null,
      isLoading: true,
      isInitialized: false,
      error: null,

      // Setters
      setUser: (user) => set({ user }),
      setSession: (session) => set({ session }),
      setProfile: (profile) => set({ profile }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setInitialized: (isInitialized) => set({ isInitialized }),

      // Sign in with Google OAuth
      signInWithGoogle: async () => {
        try {
          set({ isLoading: true, error: null });
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: `${window.location.origin}/auth/callback`,
              queryParams: {
                access_type: 'offline',
                prompt: 'consent',
              },
            },
          });
          if (error) throw error;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign in';
          set({ error: message, isLoading: false });
        }
      },

      // Sign in with email/password
      signInWithEmail: async (email: string, password: string) => {
        try {
          set({ isLoading: true, error: null });
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (data.user) {
            set({ user: data.user, session: data.session });
            await get().fetchProfile();
            set({ isLoading: false });
            return true;
          }
          return false;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign in';
          set({ error: message, isLoading: false });
          return false;
        }
      },

      // Sign up with email/password
      signUpWithEmail: async (email: string, password: string, fullName: string) => {
        try {
          set({ isLoading: true, error: null });
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName },
            },
          });
          if (error) throw error;
          if (data.user) {
            set({ user: data.user, session: data.session });
            await get().fetchProfile();
            set({ isLoading: false });
            return true;
          }
          return false;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign up';
          set({ error: message, isLoading: false });
          return false;
        }
      },

      // Sign out
      signOut: async () => {
        try {
          set({ isLoading: true, error: null });
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
          set({ user: null, session: null, profile: null, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign out';
          set({ error: message, isLoading: false });
        }
      },

      // Fetch user profile from database
      fetchProfile: async () => {
        const { user } = get();
        if (!user) return;

        try {
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error && error.code === 'PGRST116') {
            // User not found, create new profile
            const newProfile = {
              id: user.id,
              email: user.email!,
              full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
              avatar_url: user.user_metadata?.avatar_url || null,
              ecopoints_balance: 0,
              total_distance_km: 0,
              total_walks: 0,
              current_streak: 0,
              longest_streak: 0,
              last_walk_date: null,
              subscription_tier: 'free',
            };

            const { data: created, error: createError } = await supabase
              .from('users')
              .insert(newProfile)
              .select()
              .single();

            if (createError) throw createError;
            set({ profile: created as UserProfile });
          } else if (error) {
            throw error;
          } else {
            set({ profile: data as UserProfile });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load profile';
          set({ error: message });
        }
      },

      // Update user profile
      updateProfile: async (updates) => {
        const { user } = get();
        if (!user) return;

        try {
          set({ isLoading: true, error: null });
          const { data, error } = await supabase
            .from('users')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', user.id)
            .select()
            .single();

          if (error) throw error;
          set({ profile: data as UserProfile, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to update profile';
          set({ error: message, isLoading: false });
        }
      },

      // Initialize auth state
      initialize: async () => {
        try {
          set({ isLoading: true });

          // Race the session check against a timeout to prevent infinite loading
          const sessionPromise = supabase.auth.getSession();
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
          const result = await Promise.race([sessionPromise, timeoutPromise]);

          if (result && 'data' in result && result.data.session) {
            set({ user: result.data.session.user, session: result.data.session });
            // Await profile fetch so pages have profile data ready
            await get().fetchProfile().catch(console.error);
          }

          set({ isLoading: false, isInitialized: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to initialize';
          set({ error: message, isLoading: false, isInitialized: true });
        }
      },

      // Mark onboarding as completed
      completeOnboarding: () => {
        const { profile } = get();
        if (profile) {
          set({ profile: { ...profile, onboarding_completed: true } });
        }
        localStorage.setItem('breeva_onboarding_completed', 'true');
      },
    }),
    {
      name: 'breeva-auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist minimal data — session is managed by Supabase
        profile: state.profile,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('Auth store rehydrated');
        }
      },
    }
  )
);
