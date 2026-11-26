import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { UserProfile } from './authStore';
import { levelForXp, tierForLevel } from '../lib/metrics';
import { nextStreak, validateWalk, walkCo2Grams, walkEcoPoints, walkKm, type WalkPoint } from '../lib/walkPoints';

/**
 * Guest mode (F1-17): the full app without an account. Everything lives on this device (localStorage key
 * 'breeva-guest'); while it is on, the app makes no request to the account server (see isGuest() call sites and the
 * guarded fetch in lib/supabase.ts).
 */

export const GUEST_NAME = 'Tamu';
export const GUEST_NEEDS_ACCOUNT =
  'Fitur ini butuh akun Breeva. Masuk dengan Google atau email agar poin, misi, dan riwayatmu tersimpan di akun; peta, rute, dan catatan jalanmu tetap berjalan di perangkat ini.';

export interface GuestProfile {
  ecopoints_balance: number;
  /** Lifetime positive points (never spent), like users.xp. */
  xp: number;
  total_distance_km: number;
  total_walks: number;
  total_co2_saved_grams: number;
  current_streak: number;
  longest_streak: number;
  last_walk_date: string | null;
  created_at: string;
}

export interface GuestWalk {
  id: string;
  started_at: string;
  completed_at: string;
  distance_meters: number;
  duration_seconds: number;
  avg_aqi: number | null;
  ecopoints_earned: number;
  co2_saved_grams: number;
  transport_mode: string;
}

export interface GuestWalkInput {
  id: string;
  started_at: string;
  distance_meters: number;
  duration_seconds: number;
  avg_aqi?: number | null;
  transport_mode?: string;
  route_points?: WalkPoint[];
}

export type GuestWalkResult =
  | { ok: true; walk: GuestWalk; profile: GuestProfile }
  | { ok: false; reason: string };

/** Walks kept on the device (newest first); older ones drop off, the totals keep them. */
export const GUEST_WALK_LIMIT = 200;

export function emptyGuestProfile(now = new Date()): GuestProfile {
  return {
    ecopoints_balance: 0, xp: 0, total_distance_km: 0, total_walks: 0, total_co2_saved_grams: 0,
    current_streak: 0, longest_streak: 0, last_walk_date: null, created_at: now.toISOString(),
  };
}

/**
 * A completed walk applied to the guest profile, the way /api/walks/complete does it on the server: validation first,
 * then the streak (update_user_streak), then points, CO2 and totals (complete_walk). `today` is the local calendar day.
 */
export function applyGuestWalk(profile: GuestProfile, input: GuestWalkInput, today: string, now = new Date()): GuestWalkResult {
  const distance = Math.round(input.distance_meters);
  const duration = Math.round(input.duration_seconds);
  const check = validateWalk(distance, duration, input.route_points);
  if (!check.valid) return { ok: false, reason: check.reason ?? 'invalid' };
  const avgAqi = input.avg_aqi != null && Number.isFinite(input.avg_aqi) ? Math.round(input.avg_aqi) : null;
  const points = walkEcoPoints(distance, avgAqi);
  const co2 = walkCo2Grams(distance);
  const streak = nextStreak(profile, today);
  const walk: GuestWalk = {
    id: input.id,
    started_at: input.started_at,
    completed_at: now.toISOString(),
    distance_meters: distance,
    duration_seconds: duration,
    avg_aqi: avgAqi,
    ecopoints_earned: points,
    co2_saved_grams: co2,
    transport_mode: input.transport_mode || 'walking',
  };
  return {
    ok: true,
    walk,
    profile: {
      ...profile,
      ...streak,
      ecopoints_balance: profile.ecopoints_balance + points,
      xp: profile.xp + points,
      total_distance_km: Math.round((profile.total_distance_km + walkKm(distance)) * 100) / 100,
      total_walks: profile.total_walks + 1,
      total_co2_saved_grams: profile.total_co2_saved_grams + co2,
      last_walk_date: today,
    },
  };
}

/** The guest profile in the shape the app's pages read (authStore.profile). */
export function guestUserProfile(p: GuestProfile): UserProfile {
  const level = levelForXp(p.xp);
  return {
    id: 'guest',
    email: '',
    full_name: GUEST_NAME,
    avatar_url: null,
    ecopoints_balance: p.ecopoints_balance,
    total_distance_km: p.total_distance_km,
    total_walks: p.total_walks,
    total_co2_saved_grams: p.total_co2_saved_grams,
    current_streak: p.current_streak,
    longest_streak: p.longest_streak,
    last_walk_date: p.last_walk_date,
    subscription_tier: 'free',
    xp: p.xp,
    level,
    tier: tierForLevel(level),
    created_at: p.created_at,
    updated_at: p.created_at,
    onboarding_completed: true,
  };
}

function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface GuestState {
  active: boolean;
  profile: GuestProfile;
  walks: GuestWalk[];
  /** Turn guest mode on (keeps an earlier guest profile on this device). */
  enter: () => void;
  /** Turn guest mode off; the local records stay on the device for the next guest session. */
  exit: () => void;
  /** Record a completed walk locally; returns the points earned or why the walk was refused. */
  completeWalk: (input: GuestWalkInput) => GuestWalkResult;
}

export const useGuestStore = create<GuestState>()(
  persist(
    (set, get) => ({
      active: false,
      profile: emptyGuestProfile(),
      walks: [],
      enter: () => set({ active: true }),
      exit: () => set({ active: false }),
      completeWalk: (input) => {
        const r = applyGuestWalk(get().profile, input, localDay());
        if (r.ok) set({ profile: r.profile, walks: [r.walk, ...get().walks.filter((w) => w.id !== r.walk.id)].slice(0, GUEST_WALK_LIMIT) });
        return r;
      },
    }),
    {
      name: 'breeva-guest',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ active: s.active, profile: s.profile, walks: s.walks }),
    },
  ),
);

/** True while the app runs as a guest: no account, no request to the account server. */
export function isGuest(): boolean {
  return useGuestStore.getState().active;
}

/** React hook form of isGuest(). */
export function useIsGuest(): boolean {
  return useGuestStore((s) => s.active);
}
