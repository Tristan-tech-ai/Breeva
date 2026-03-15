import { create } from 'zustand';
import type { Coordinate, RoutePoint, WalkSession, ExposureResult } from '../types';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './authStore';
import { getVayuExposure, getVayuVehicleType, submitVayuContribution } from '../lib/api';
import { checkAndUnlockAchievements } from '../lib/achievements';

interface WalkTrackingState {
  // Walk session
  session: WalkSession | null;
  isTracking: boolean;
  isPaused: boolean;

  // GPS
  routePoints: RoutePoint[];
  currentPosition: Coordinate | null;
  watchId: number | null;

  // Stats
  distanceMeters: number;
  durationSeconds: number;
  currentSpeed: number; // m/s
  pointsEarned: number;

  // Timer
  timerInterval: ReturnType<typeof setInterval> | null;
  startTime: number | null;
  pausedDuration: number;

  // Anti-cheat
  maxSpeed: number; // 7 km/h = ~1.94 m/s
  speedWarnings: number;
  stepCount: number;

  // VAYU exposure result
  exposureResult: ExposureResult | null;
  activeTransportMode: string;

  // Actions
  startWalk: (routeId?: string, transportMode?: string) => void;
  pauseWalk: () => void;
  resumeWalk: () => void;
  endWalk: () => Promise<WalkSession | null>;
  cancelWalk: () => void;
  addRoutePoint: (point: RoutePoint) => void;
  updateStats: () => void;
}

// Haversine distance between two coordinates (meters)
function haversineDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aVal =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

// Calculate EcoPoints for a walk
function calculatePoints(distanceMeters: number, avgAQI: number): number {
  // Base: 10 points per km
  let points = (distanceMeters / 1000) * 10;

  // Multiplier for cleaner routes
  if (avgAQI <= 50) points *= 1.5; // Good AQI
  else if (avgAQI <= 100) points *= 1.2; // Moderate
  // No bonus for unhealthy

  return Math.round(points);
}

export const useWalkStore = create<WalkTrackingState>()((set, get) => ({
  session: null,
  isTracking: false,
  isPaused: false,
  routePoints: [],
  currentPosition: null,
  watchId: null,
  distanceMeters: 0,
  durationSeconds: 0,
  currentSpeed: 0,
  pointsEarned: 0,
  timerInterval: null,
  startTime: null,
  pausedDuration: 0,
  maxSpeed: 1.94, // 7 km/h
  speedWarnings: 0,
  stepCount: 0,
  exposureResult: null,
  activeTransportMode: 'walking',

  startWalk: (routeId, transportMode) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const session: WalkSession = {
      id: routeId || crypto.randomUUID(),
      user_id: user.id,
      start_time: new Date().toISOString(),
      route_points: [],
      distance_meters: 0,
      duration_seconds: 0,
      avg_speed_mps: 0,
      eco_points_earned: 0,
      status: 'active',
    };

    set({
      session,
      isTracking: true,
      isPaused: false,
      routePoints: [],
      distanceMeters: 0,
      durationSeconds: 0,
      currentSpeed: 0,
      pointsEarned: 0,
      speedWarnings: 0,
      stepCount: 0,
      startTime: Date.now(),
      pausedDuration: 0,
      exposureResult: null,
      activeTransportMode: transportMode || 'walking',
    });

    // Start GPS tracking
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (get().isPaused) return;

          const point: RoutePoint = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            timestamp: new Date().toISOString(),
          };

          get().addRoutePoint(point);
          set({ currentPosition: point });
        },
        (error) => {
          console.warn('GPS error during walk:', error.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 2000,
          timeout: 10000,
        }
      );

      set({ watchId });
    }

    // Start timer
    const timerInterval = setInterval(() => {
      if (!get().isPaused) {
        const { startTime, pausedDuration } = get();
        if (startTime) {
          const elapsed = Math.floor((Date.now() - startTime - pausedDuration) / 1000);
          set({ durationSeconds: elapsed });
        }
        get().updateStats();
      }
    }, 1000);

    set({ timerInterval });
  },

  pauseWalk: () => {
    set({ isPaused: true });
    const session = get().session;
    if (session) {
      set({ session: { ...session, status: 'paused' } });
    }
  },

  resumeWalk: () => {
    set({ isPaused: false });
    const session = get().session;
    if (session) {
      set({ session: { ...session, status: 'active' } });
    }
  },

  endWalk: async () => {
    const { session, routePoints, distanceMeters, durationSeconds, watchId, timerInterval } = get();

    // Clean up watchers
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    if (!session || distanceMeters < 50) {
      // Minimum 50m to count as a walk
      set({
        session: null,
        isTracking: false,
        isPaused: false,
        watchId: null,
        timerInterval: null,
      });
      return null;
    }

    const avgSpeed = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;
    let points = calculatePoints(distanceMeters, 50); // Fallback AQI

    const completedSession: WalkSession = {
      ...session,
      end_time: new Date().toISOString(),
      route_points: routePoints,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      avg_speed_mps: avgSpeed,
      eco_points_earned: points,
      status: 'completed',
    };

    // Compute VAYU exposure (non-blocking for UX)
    const polyline: [number, number][] = routePoints.map(p => [p.lat, p.lng]);
    if (polyline.length >= 2) {
      const vehicleType = getVayuVehicleType(get().activeTransportMode);
      const durationMin = Math.max(1, Math.round(durationSeconds / 60));
      getVayuExposure(polyline, vehicleType, durationMin).then((result) => {
        if (result) {
          set({ exposureResult: result });
        }
      });

      // Auto-contribute walk trace to VAYU crowdsource (non-blocking)
      submitVayuContribution(session.id, vehicleType).catch(() => {});
    }

    // Save to Supabase
    try {
      const user = useAuthStore.getState().user;
      if (user) {
        // 1. Insert walk with initial data (status 'active')
        const { error: insertErr } = await supabase.from('walks').insert({
          id: completedSession.id,
          user_id: user.id,
          origin_lat: routePoints[0]?.lat || 0,
          origin_lng: routePoints[0]?.lng || 0,
          destination_lat: routePoints[routePoints.length - 1]?.lat || 0,
          destination_lng: routePoints[routePoints.length - 1]?.lng || 0,
          route_polyline: JSON.stringify(routePoints.map(p => [p.lat, p.lng])),
          distance_meters: Math.round(distanceMeters),
          duration_seconds: durationSeconds,
          route_type: 'eco',
          status: 'active',
          started_at: completedSession.start_time,
        });

        if (insertErr) {
          console.error('Failed to insert walk:', insertErr);
        } else {
          // 2. Call complete_walk RPC — updates walk record, user stats, awards points
          const { data: walkResult, error: rpcErr } = await supabase.rpc('complete_walk', {
            p_walk_id: completedSession.id,
            p_distance_meters: Math.round(distanceMeters),
            p_duration_seconds: durationSeconds,
            p_avg_aqi: 50, // Default AQI; later replaced by VAYU
          });

          if (rpcErr) {
            console.error('complete_walk RPC failed:', rpcErr);
          } else if (walkResult && walkResult.length > 0) {
            const { ecopoints_earned } = walkResult[0];
            points = ecopoints_earned || points;
          }

          // 3. Update streak
          await supabase.rpc('update_user_streak', { p_user_id: user.id });

          // 4. Check achievements
          checkAndUnlockAchievements(user.id).catch(console.error);

          // 5. Refresh profile to pick up new stats
          useAuthStore.getState().fetchProfile();
        }
      }
    } catch (error) {
      console.error('Failed to save walk:', error);
    }

    set({
      session: completedSession,
      isTracking: false,
      isPaused: false,
      watchId: null,
      timerInterval: null,
      pointsEarned: points,
    });

    return completedSession;
  },

  cancelWalk: () => {
    const { watchId, timerInterval } = get();
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timerInterval) clearInterval(timerInterval);

    set({
      session: null,
      isTracking: false,
      isPaused: false,
      routePoints: [],
      distanceMeters: 0,
      durationSeconds: 0,
      currentSpeed: 0,
      pointsEarned: 0,
      watchId: null,
      timerInterval: null,
      startTime: null,
      pausedDuration: 0,
    });
  },

  addRoutePoint: (point) => {
    const { routePoints, maxSpeed } = get();
    const lastPoint = routePoints[routePoints.length - 1];

    if (lastPoint) {
      const dist = haversineDistance(lastPoint, point);
      const timeDiff =
        (new Date(point.timestamp || '').getTime() -
          new Date(lastPoint.timestamp || '').getTime()) /
        1000;

      if (timeDiff > 0) {
        const speed = dist / timeDiff;

        // Anti-cheat: skip if moving too fast (> 7 km/h)
        if (speed > maxSpeed * 2) {
          set({ speedWarnings: get().speedWarnings + 1 });
          return; // Likely GPS teleportation
        }

        set((state) => ({
          routePoints: [...state.routePoints, point],
          distanceMeters: state.distanceMeters + dist,
          currentSpeed: speed,
        }));
        return;
      }
    }

    // First point or no time diff
    set((state) => ({
      routePoints: [...state.routePoints, point],
    }));
  },

  updateStats: () => {
    const { distanceMeters } = get();
    const points = calculatePoints(distanceMeters, 50);
    set({ pointsEarned: points });
  },
}));
