// Executors for Vayu's function-calling tools. The Edge model returns a
// `tool_call`; the frontend runs the matching action here (driving the real
// mapStore/api), then sends the `response` back for the model to summarize.
// Some tools also return `ui` metadata so the chat can show a one-tap action.

import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { searchPlaces } from './api';
import { computeDose, type ExposureMode } from './exposure';
import type { TransportMode } from '../types';

export interface ToolUiAction {
  kind: 'showRoute' | 'openPaparan';
  label?: string;
}
export interface ToolExecResult {
  response: unknown;
  ui?: ToolUiAction;
}

const r = (n: number | null | undefined, d = 1): number | undefined =>
  n == null || Number.isNaN(n) ? undefined : Math.round(n * 10 ** d) / 10 ** d;

function toExposureMode(t: TransportMode): ExposureMode {
  switch (t) {
    case 'cycling': case 'ebike': return 'cycle';
    case 'motorcycle': return 'motorcycle_open';
    case 'car': return 'car_ac_fresh';
    default: return 'walk_slow';
  }
}

type Executor = (args: Record<string, unknown>) => Promise<ToolExecResult>;

export const CHAT_TOOL_EXECUTORS: Record<string, Executor> = {
  check_air_now: async () => {
    const m = useMapStore.getState();
    let aqi = m.currentAQI;
    if (!aqi && m.userLocation) {
      await m.fetchAirQuality(m.userLocation);
      aqi = useMapStore.getState().currentAQI;
    }
    if (!aqi) return { response: { available: false, reason: 'location/AQI not available yet' } };
    return { response: { aqi: aqi.aqi, level: aqi.level, pm25: r(aqi.pm25), freshness: aqi.freshness } };
  },

  find_clean_route: async (args) => {
    const dest = String(args.destination ?? '').trim();
    const m = useMapStore.getState();
    if (!dest) return { response: { found: false, reason: 'no destination given' } };
    const { places } = await searchPlaces(dest, m.userLocation ?? undefined);
    if (!places || places.length === 0) return { response: { found: false, destination: dest } };
    const top = places[0];
    await m.setDestination(top.coordinate, top.name);
    await m.calculateRoutes();
    const routes = useMapStore.getState().routes;
    if (!routes || routes.length === 0) {
      return { response: { found: true, destinationName: top.name, routesAvailable: false }, ui: { kind: 'showRoute' } };
    }
    const pick = (...keys: string[]) =>
      routes.find((rt) => keys.includes((rt.route_label ?? rt.route_type) as string));
    const cleanest = pick('cleanest', 'eco') ?? routes[0];
    const fastest = pick('fastest', 'fast');
    const fmt = (rt?: typeof routes[number]) =>
      rt ? {
        avg_aqi: Math.round(rt.vayu_avg_aqi ?? rt.avg_aqi ?? 0),
        trap_reduction_pct: rt.vayu_trap_reduction_pct,
        duration_min: Math.round((rt.duration_seconds ?? 0) / 60),
        distance_km: r((rt.distance_meters ?? 0) / 1000),
      } : null;
    const cAqi = Math.round(cleanest.vayu_avg_aqi ?? cleanest.avg_aqi ?? 0);
    const trap = cleanest.vayu_trap_reduction_pct;
    return {
      response: { found: true, destinationName: top.name, cleanest: fmt(cleanest), fastest: fmt(fastest) },
      ui: { kind: 'showRoute', label: `AQI ${cAqi}${trap != null ? ` · −${Math.round(trap)}% trap` : ''}` },
    };
  },

  estimate_exposure: async () => {
    const m = useMapStore.getState();
    const route = m.selectedRoute ?? m.routes?.[0];
    const segs = route?.vayu_score?.segments;
    if (!route || !segs || segs.length === 0) {
      return { response: { available: false, hint: 'Pick a route first, or open the exposure calculator.' }, ui: { kind: 'openPaparan' } };
    }
    const dose = computeDose(
      segs.map((s) => ({ pm25: s.pm25, fraction_along: s.fraction_along })),
      route.duration_seconds ?? 0,
      { age_bucket: 'adult', mode: toExposureMode(m.transportMode), health_sensitive: false },
    );
    return {
      response: {
        available: true,
        dose_ug: Math.round(dose.dose_ug),
        cigarette_equiv: r(dose.cigarette_equiv, 2),
        who_24h_ratio: r(dose.who_24h_ratio),
        risk_level: dose.risk_level,
      },
      ui: { kind: 'openPaparan' },
    };
  },

  set_transport_mode: async (args) => {
    const allowed: TransportMode[] = ['walking', 'cycling', 'ebike', 'motorcycle', 'car'];
    const mode = String(args.mode ?? '') as TransportMode;
    if (!allowed.includes(mode)) return { response: { ok: false, reason: 'invalid mode' } };
    useMapStore.getState().setTransportMode(mode);
    return { response: { ok: true, mode } };
  },

  my_stats: async () => {
    const p = useAuthStore.getState().profile;
    if (!p) return { response: { loggedIn: false } };
    return {
      response: {
        loggedIn: true,
        name: p.full_name ?? undefined,
        level: p.level,
        streak: p.current_streak,
        ecopoints: p.ecopoints_balance,
        total_km: r(p.total_distance_km),
        co2_saved_g: p.total_co2_saved_grams,
      },
    };
  },
};
