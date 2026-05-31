import { create } from 'zustand';
import ngeohash from 'ngeohash';
import toast from 'react-hot-toast';
import type { Coordinate, RoutePoint, WalkSession, ExposureResult } from '../types';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './authStore';
import { completeWalkViaApi, getVayuVehicleType, submitVayuContribution, getRouteScoreSegments, pm25ToAQISimple } from '../lib/api';
import { showNotification, isNotificationEnabled } from '../lib/notifications';
import { formatLocalDateYYYYMMDD } from '../lib/utils';
import { computeDose, type ExposureMode, type ExposureDoseResult, type UserExposureProfile } from '../lib/exposure';
import { saveExposureLedger } from '../lib/exposure-ledger';

// Map the walk's transport mode to the exposure dose model's mode.
function transportToExposureMode(t: string): ExposureMode {
  switch (t) {
    case 'cycling': case 'ebike': return 'cycle';
    case 'motorcycle': return 'motorcycle_open';
    case 'car': return 'car_ac_fresh';
    default: return 'walk_slow';
  }
}

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

  // Live AQI refresh throttle — last time we asked mapStore to refetch AQI
  // for the user's current location during a walk.
  _lastAqiAt: number;

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
  _lastAqiAt: 0,

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

          // Refresh AQI for the user's new location at most once per 60s.
          // Otherwise the LiveExposureTracker accumulates dose against the
          // AQI value that was loaded when the app started — could be hours
          // old and far from where the user actually is.
          const now = Date.now();
          if (now - get()._lastAqiAt > 60_000) {
            set({ _lastAqiAt: now });
            import('./mapStore')
              .then(({ useMapStore }) => useMapStore.getState().fetchAirQuality(point))
              .catch(() => { /* non-fatal */ });
          }
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
      // Minimum 50m to count as a walk. Show feedback so users don't tap
      // "End Walk" into a void.
      set({
        session: null,
        isTracking: false,
        isPaused: false,
        watchId: null,
        timerInterval: null,
      });
      if (session) {
        toast('Jalan terlalu pendek (<50m) — tidak dicatat.', { icon: '🚶' });
      }
      return null;
    }

    const avgSpeed = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;
    const clientEstimate = calculatePoints(distanceMeters, 50); // Fallback AQI
    let points = clientEstimate;

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

    // Compute VAYU exposure. Await with a 3s timeout so the WalkComplete modal
    // can render the "Air Exposure" card with real data. Without the await,
    // the modal opens with exposureResult=null and the user never sees this.
    // Unified inhaled-dose (shared src/lib/exposure) from the walk's v2-scored polyline — replaces
    // the old vehicle-model exposure.ts call so the modal + ledger use ONE methodology. Captured for
    // best-effort persistence after the walk row is saved.
    let walkDose: ExposureDoseResult | null = null;
    let walkProfile: UserExposureProfile | null = null;
    let walkSegCount = 0;
    const polyline: [number, number][] = routePoints.map(p => [p.lat, p.lng]);
    if (polyline.length >= 2) {
      const vehicleType = getVayuVehicleType(get().activeTransportMode);
      walkProfile = { age_bucket: 'adult', mode: transportToExposureMode(get().activeTransportMode), health_sensitive: false };

      const scorePromise = getRouteScoreSegments(polyline, durationSeconds);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
      try {
        const score = await Promise.race([scorePromise, timeoutPromise]);
        if (score?.segments?.length) {
          const dose = computeDose(score.segments, durationSeconds, walkProfile);
          walkDose = dose;
          walkSegCount = score.segments.length;
          set({ exposureResult: {
            total_dose_ug: dose.dose_ug,
            cigarette_equivalent: dose.cigarette_equiv,
            health_risk_level: dose.risk_level,
            avg_pm25: dose.mean_pm25,
            vehicle_type: get().activeTransportMode,
            vehicle_label: '',
            duration_minutes: dose.duration_minutes,
            sample_count: score.segments.length,
          } });
        }
      } catch { /* ignore */ }

      // Auto-contribute walk trace. Geohash from route midpoint (precision 7
      // ≈ 153m × 153m cells) replaces the literal 'unknown' string that was
      // polluting the contributions table.
      const midPoint = polyline[Math.floor(polyline.length / 2)];
      const geohash = ngeohash.encode(midPoint[0], midPoint[1], 7);
      submitVayuContribution(session.id, vehicleType, undefined, geohash).then(async (ok) => {
        if (ok) {
          const user = useAuthStore.getState().user;
          if (user) {
            try {
              await supabase.rpc('claim_reward', {
                p_user_id: user.id,
                p_type: 'vayu_contribution',
                p_reference_id: session.id,
              });
            } catch { /* ignore */ }
          }
        }
      }).catch(() => {});
    }

    // Complete walk via API (with offline queue fallback)
    try {
      const user = useAuthStore.getState().user;
      if (user) {
        // Real route-mean AQI from the v2-scored polyline (drives the server AQI
        // bonus + the "clean air" quest). Omit when exposure couldn't be scored.
        const avgAqi = walkDose && Number.isFinite(walkDose.mean_pm25)
          ? pm25ToAQISimple(walkDose.mean_pm25)
          : undefined;
        const completionResult = await completeWalkViaApi({
          walk_id: completedSession.id,
          user_id: user.id,
          distance_meters: Math.round(distanceMeters),
          duration_seconds: durationSeconds,
          avg_aqi: avgAqi,
          transport_mode: get().activeTransportMode,
          started_at: completedSession.start_time,
          route_points: routePoints,
        });

        if (!completionResult.success) {
          throw new Error('Walk completion failed');
        }

        if (!completionResult.queued && completionResult.ecopoints_earned > 0) {
          points = completionResult.ecopoints_earned;
          // Mutate the session object too — the WalkComplete modal reads
          // session.eco_points_earned, so without this it would display the
          // stale clientEstimate.
          completedSession.eco_points_earned = points;
          // Achievement unlocks are now done server-side inside complete.ts —
          // no client-side double-fire (was causing double-pay races).
        }

        // Await profile refresh so ProfilePage / header chips show the new
        // balance immediately, not on next session.
        await useAuthStore.getState().fetchProfile();

        // Best-effort: persist the unified exposure dose to exposure_ledger (RLS own-rows; non-blocking).
        if (walkDose && walkProfile) {
          saveExposureLedger(walkDose, walkProfile, {
            source: 'walk', walk_id: completedSession.id, durationSeconds, segmentCount: walkSegCount,
          }).catch(() => {});
        }

        localStorage.setItem('breeva_last_walk_date', formatLocalDateYYYYMMDD());

        if (isNotificationEnabled()) {
          const body = completionResult.queued
            ? `${(distanceMeters / 1000).toFixed(2)} km saved offline. Akan sinkron saat online.`
            : `${(distanceMeters / 1000).toFixed(2)} km walked — +${points} EcoPoints earned`;

          showNotification('🚶 Walk Complete!', body, { url: '/eco-impact', tag: 'walk-complete' }).catch(() => {});
        }
      }
    } catch (error) {
      console.error('Failed to save walk:', error);
      // Mark session as failed so UI can inform user
      completedSession.status = 'failed' as WalkSession['status'];
    }

    set({
      session: completedSession,
      isTracking: false,
      isPaused: false,
      watchId: null,
      timerInterval: null,
      pointsEarned: completedSession.status === 'completed' ? points : 0,
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
