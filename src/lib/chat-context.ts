// Snapshots the app's live state into the compact `context` object sent to the
// chat Edge Function on every turn, so Vayu's answers are grounded + personalized.
// Pure getState() reads (works outside React); call on each send for freshness.

import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

const r = (n: number | null | undefined, d = 1): number | undefined =>
  n == null || Number.isNaN(n) ? undefined : Math.round(n * 10 ** d) / 10 ** d;

export function buildChatContext(): Record<string, unknown> {
  const m = useMapStore.getState();
  const profile = useAuthStore.getState().profile;
  const locale = useSettingsStore.getState().language;
  const aqi = m.currentAQI;
  const sel = m.selectedRoute;

  const ctx: Record<string, unknown> = {
    locale,
    user: m.userLocation
      ? { lat: r(m.userLocation.lat, 3), lng: r(m.userLocation.lng, 3), loggedIn: !!profile }
      : { loggedIn: !!profile },
  };

  if (aqi) {
    ctx.aqi = { value: aqi.aqi, level: aqi.level, pm25: r(aqi.pm25), freshness: aqi.freshness };
  }
  if (profile) {
    ctx.profile = {
      name: profile.full_name ?? undefined,
      level: profile.level,
      streak: profile.current_streak,
      ecopoints: profile.ecopoints_balance,
      total_km: r(profile.total_distance_km),
      co2_saved_g: profile.total_co2_saved_grams,
    };
  }
  if (m.destinationName) {
    ctx.trip = {
      destinationName: m.destinationName,
      transportMode: m.transportMode,
      selectedRoute: sel
        ? {
            label: sel.route_label ?? sel.route_type,
            avg_aqi: Math.round(sel.vayu_avg_aqi ?? sel.avg_aqi ?? 0),
            trap_reduction_pct: sel.vayu_trap_reduction_pct,
            duration_min: Math.round((sel.duration_seconds ?? 0) / 60),
          }
        : undefined,
    };
  }
  return ctx;
}
