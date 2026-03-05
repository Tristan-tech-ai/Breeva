import { create } from 'zustand';
import type { Coordinate, Route, AirQualityData, TransportMode } from '../types';
import {
  getDirections,
  searchPlaces,
  reverseGeocode,
  getAirQuality,
  TRANSPORT_MODES,
  getAreaEnvironmentData,
  analyzeRouteEnvironment,
  refineAQIWithGemini,
  planRouteWaypoints,
  pickEcoWaypoint,
  getPerpendicularWaypoint,
  routeGeometrySimilar,
} from '../lib/api';

export interface SearchResult {
  name: string;
  coordinate: Coordinate;
}

type BottomSheetState = 'peek' | 'half' | 'full' | 'hidden';

interface MapState {
  // Map state
  center: Coordinate;
  zoom: number;
  userLocation: Coordinate | null;
  isLocating: boolean;
  locationError: string | null;
  watchId: number | null;

  // Search state
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  recentSearches: SearchResult[];

  // Destination
  destination: Coordinate | null;
  destinationName: string | null;

  // Routes
  routes: Route[];
  selectedRoute: Route | null;
  isCalculatingRoutes: boolean;
  transportMode: TransportMode;

  // Air Quality
  currentAQI: AirQualityData | null;
  routeAQIs: Map<string, AirQualityData>;

  // Bottom Sheet
  bottomSheetState: BottomSheetState;

  // Actions
  setCenter: (center: Coordinate) => void;
  setZoom: (zoom: number) => void;
  setUserLocation: (location: Coordinate | null) => void;
  startLocating: () => void;
  stopLocating: () => void;
  setSearchQuery: (query: string) => void;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  setDestination: (coord: Coordinate, name?: string) => Promise<void>;
  clearDestination: () => void;
  calculateRoutes: () => Promise<void>;
  selectRoute: (route: Route) => void;
  clearRoutes: () => void;
  setTransportMode: (mode: TransportMode) => void;
  fetchAirQuality: (coord: Coordinate) => Promise<void>;
  setBottomSheetState: (state: BottomSheetState) => void;
  addRecentSearch: (result: SearchResult) => void;
}

// Load recent searches from localStorage
const loadRecentSearches = (): SearchResult[] => {
  try {
    const stored = localStorage.getItem('breeva_recent_searches');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const useMapStore = create<MapState>()((set, get) => ({
  // Initial state — default center: Jakarta
  center: { lat: -6.2088, lng: 106.8456 },
  zoom: 15,
  userLocation: null,
  isLocating: false,
  locationError: null,
  watchId: null,

  searchQuery: '',
  searchResults: [],
  isSearching: false,
  recentSearches: loadRecentSearches(),

  destination: null,
  destinationName: null,

  routes: [],
  selectedRoute: null,
  isCalculatingRoutes: false,
  transportMode: 'walking' as TransportMode,

  currentAQI: null,
  routeAQIs: new Map(),

  bottomSheetState: 'peek',

  // Actions
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setUserLocation: (location) => {
    set({ userLocation: location });
    // Do NOT auto-set center here — that causes constant camera jitter
  },

  startLocating: () => {
    if (!navigator.geolocation) {
      set({ locationError: 'Geolocation is not supported by your browser' });
      return;
    }

    set({ isLocating: true, locationError: null });

    // Get initial position — use maximumAge: 0 for a fresh fix
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        set({ userLocation: location, center: location, isLocating: false });

        // Fetch AQI for user location
        get().fetchAirQuality(location);
      },
      (error) => {
        set({ locationError: error.message, isLocating: false });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Watch position for live updates — short cache for smoother UX
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        set({
          userLocation: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        });
      },
      (error) => {
        console.warn('Position watch error:', error.message);
      },
      { enableHighAccuracy: true, maximumAge: 3000 }
    );

    set({ watchId });
  },

  stopLocating: () => {
    const { watchId } = get();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      set({ watchId: null });
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  search: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }

    set({ isSearching: true });
    const { userLocation } = get();
    const { places } = await searchPlaces(query, userLocation || undefined);
    set({ searchResults: places, isSearching: false });
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),

  setDestination: async (coord, name) => {
    if (!name) {
      const { address } = await reverseGeocode(coord);
      name = address || `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`;
    }
    set({
      destination: coord,
      destinationName: name,
      bottomSheetState: 'half',
    });

    // Also add to recent searches
    get().addRecentSearch({ name: name!, coordinate: coord });
  },

  clearDestination: () =>
    set({
      destination: null,
      destinationName: null,
      routes: [],
      selectedRoute: null,
      bottomSheetState: 'peek',
    }),

  calculateRoutes: async () => {
    const { userLocation, destination, transportMode } = get();
    if (!userLocation || !destination) return;

    set({ isCalculatingRoutes: true, routes: [], selectedRoute: null });

    const modeInfo = TRANSPORT_MODES.find((m) => m.id === transportMode) || TRANSPORT_MODES[0];

    try {
      const midpoint: Coordinate = {
        lat: (userLocation.lat + destination.lat) / 2,
        lng: (userLocation.lng + destination.lng) / 2,
      };

      // ── Step 1: Parallel fetch — Overpass env data + AQI ──
      const [envData, aqiResult] = await Promise.all([
        getAreaEnvironmentData(userLocation, destination),
        getAirQuality(midpoint),
      ]);

      const baseAQI = aqiResult.data?.aqi ?? 50;
      const { greenSpaces, roads, pollutionSources, waterBodies } = envData;

      // ── Step 2: Ask Gemini to plan 3 different waypoint strategies ──
      // Gemini analyzes the Overpass data (parks, roads, water, pollution)
      // and picks specific waypoints that will pull each route in a
      // genuinely different geographic direction.
      const geminiPlan = await planRouteWaypoints(
        userLocation, destination, envData, baseAQI
      );

      // ── Step 3: Build route requests from Gemini plan + fallbacks ──
      type RouteStrategy = {
        label: 'fast' | 'balanced' | 'eco';
        waypoints?: Coordinate[];
      };

      const strategies: RouteStrategy[] = [];

      if (geminiPlan) {
        // Gemini provided waypoints — use them
        strategies.push(
          { label: 'fast', waypoints: geminiPlan.fastest.length > 0 ? geminiPlan.fastest : undefined },
          { label: 'eco', waypoints: geminiPlan.cleanest.length > 0 ? geminiPlan.cleanest : undefined },
          { label: 'balanced', waypoints: geminiPlan.balanced.length > 0 ? geminiPlan.balanced : undefined },
        );
      } else {
        // Gemini unavailable — use heuristic waypoint strategies
        // Strategy 1: Direct (fastest)
        strategies.push({ label: 'fast' });

        // Strategy 2: Through a park/green space (cleanest)
        const ecoWp = greenSpaces.length > 0
          ? pickEcoWaypoint(userLocation, destination, greenSpaces)
          : null;
        if (ecoWp) {
          strategies.push({ label: 'eco', waypoints: [ecoWp] });
        } else {
          // Force different path via perpendicular offset
          const perpWp = getPerpendicularWaypoint(userLocation, destination, 300);
          strategies.push({ label: 'eco', waypoints: [perpWp] });
        }

        // Strategy 3: Opposite perpendicular direction (balanced)
        const balancedWp = getPerpendicularWaypoint(userLocation, destination, -250);
        strategies.push({ label: 'balanced', waypoints: [balancedWp] });
      }

      // ── Step 4: Fetch all 3 routes from ORS in parallel ──
      const routeResults = await Promise.all(
        strategies.map(async (strat) => {
          try {
            const result = await getDirections(
              userLocation, destination, modeInfo.orsProfile, strat.waypoints
            );
            return { label: strat.label, route: result.routes[0] || null };
          } catch {
            return { label: strat.label, route: null };
          }
        })
      );

      // Collect successful routes
      let collected = routeResults.filter(
        (r): r is { label: 'fast' | 'balanced' | 'eco'; route: Route } => r.route !== null
      );

      // Dedup: remove routes that are geometrically identical
      const deduped: typeof collected = [];
      for (const r of collected) {
        if (!routeGeometrySimilar(r.route, deduped.map((d) => d.route), 50)) {
          deduped.push(r);
        }
      }
      collected = deduped;

      // ── Step 4b: If < 3 unique routes, supplement with ORS alternatives ──
      if (collected.length < 3) {
        try {
          const altResult = await getDirections(
            userLocation, destination, modeInfo.orsProfile, undefined,
            { alternative_routes: { share_factor: 0.3, target_count: 3, weight_factor: 2.0 } }
          );
          const missingLabels: Array<'fast' | 'balanced' | 'eco'> = (
            ['fast', 'balanced', 'eco'] as const
          ).filter((l) => !collected.some((c) => c.label === l));

          for (const alt of altResult.routes) {
            if (collected.length >= 3 || missingLabels.length === 0) break;
            if (!routeGeometrySimilar(alt, collected.map((c) => c.route), 50)) {
              collected.push({ label: missingLabels.shift()!, route: alt });
            }
          }
        } catch { /* ignore */ }
      }

      // ── Step 4c: Last resort — perpendicular fallbacks ──
      if (collected.length < 3) {
        const offsets = [350, -350, 500, -500];
        const missingLabels: Array<'fast' | 'balanced' | 'eco'> = (
          ['fast', 'balanced', 'eco'] as const
        ).filter((l) => !collected.some((c) => c.label === l));

        for (const offset of offsets) {
          if (collected.length >= 3 || missingLabels.length === 0) break;
          const wp = getPerpendicularWaypoint(userLocation, destination, offset);
          try {
            const result = await getDirections(
              userLocation, destination, modeInfo.orsProfile, [wp]
            );
            const route = result.routes[0];
            if (route && !routeGeometrySimilar(route, collected.map((c) => c.route), 50)) {
              collected.push({ label: missingLabels.shift()!, route });
            }
          } catch { /* ignore */ }
        }
      }

      if (collected.length === 0) {
        // Absolute fallback: single direct route
        const fallback = await getDirections(userLocation, destination, modeInfo.orsProfile);
        if (fallback.routes[0]) {
          collected.push({ label: 'balanced', route: fallback.routes[0] });
        }
      }

      if (collected.length === 0) {
        set({ isCalculatingRoutes: false });
        return;
      }

      // ── Step 5: Analyze each route's environment ──
      const analyzed = collected.map(({ label, route }) => {
        const env = analyzeRouteEnvironment(
          route.waypoints, roads, greenSpaces, pollutionSources, waterBodies, baseAQI
        );
        return { label, route, env };
      });

      // ── Step 5b: Re-classify labels based on actual scores ──
      // Gemini's waypoints may not perfectly match (e.g. "cleanest" waypoints
      // might route through a busy road). Re-check and reassign labels.
      if (analyzed.length >= 3) {
        const byDuration = [...analyzed].sort((a, b) => a.route.duration_seconds - b.route.duration_seconds);
        const byAQI = [...analyzed].sort((a, b) => a.env.estimatedAQI - b.env.estimatedAQI);

        // Reset labels
        for (const a of analyzed) a.label = 'balanced';

        // Fastest = shortest duration
        byDuration[0].label = 'fast';
        // Cleanest = best AQI (that isn't already fast)
        const cleanest = byAQI.find((a) => a.label !== 'fast');
        if (cleanest) cleanest.label = 'eco';
        // Rest stays balanced
      } else if (analyzed.length === 2) {
        const [a, b] = analyzed;
        if (a.route.duration_seconds <= b.route.duration_seconds) {
          a.label = 'fast';
          b.label = 'eco';
        } else {
          b.label = 'fast';
          a.label = 'eco';
        }
      } else {
        analyzed[0].label = 'balanced';
      }

      // ── Step 6: Refine AQI with Gemini (optional) ──
      let geminiAQIs: number[] | null = null;
      try {
        geminiAQIs = await refineAQIWithGemini(
          analyzed.map((r) => ({
            routeType: r.label,
            environment: r.env,
            distanceKm: r.route.distance_meters / 1000,
          })),
          baseAQI,
          midpoint
        );
      } catch { /* heuristic used */ }

      // ── Step 7: Build final routes in display order ──
      const labelOrder: Record<string, number> = { fast: 0, balanced: 1, eco: 2 };
      analyzed.sort((a, b) => (labelOrder[a.label] ?? 1) - (labelOrder[b.label] ?? 1));

      const finalRoutes: Route[] = analyzed.map((r, i) => {
        const estimatedAQI = geminiAQIs?.[i] ?? r.env.estimatedAQI;

        return {
          ...r.route,
          id: crypto.randomUUID(),
          route_type: r.label,
          avg_aqi: estimatedAQI,
          eco_points_earned: Math.round(
            (r.route.distance_meters / 1000) * modeInfo.ecoPointsMultiplier * 10
          ),
          traffic_level: r.env.trafficLevel,
          green_score: r.env.greenScore,
          aqi_confidence: geminiAQIs ? 85 : 60,
          road_summary: r.env.summary,
          aqi_factors: r.env.aqiFactors,
        };
      });

      set({
        routes: finalRoutes,
        selectedRoute: finalRoutes.find((r) => r.route_type === 'eco') || finalRoutes[0] || null,
        isCalculatingRoutes: false,
        bottomSheetState: 'half',
      });
    } catch (error) {
      console.error('Error calculating routes:', error);
      set({ isCalculatingRoutes: false });
    }
  },

  selectRoute: (route) => set({ selectedRoute: route }),
  clearRoutes: () => set({ routes: [], selectedRoute: null }),
  setTransportMode: (mode) => {
    set({ transportMode: mode, routes: [], selectedRoute: null });
    // If destination exists, recalculate immediately
    const { destination } = get();
    if (destination) {
      get().calculateRoutes();
    }
  },

  fetchAirQuality: async (coord) => {
    const { data } = await getAirQuality(coord);
    if (data) {
      set({ currentAQI: data });
    }
  },

  setBottomSheetState: (state) => set({ bottomSheetState: state }),

  addRecentSearch: (result) => {
    const { recentSearches } = get();
    // Deduplicate and limit to 5
    const filtered = recentSearches.filter(
      (s) =>
        s.coordinate.lat !== result.coordinate.lat ||
        s.coordinate.lng !== result.coordinate.lng
    );
    const updated = [result, ...filtered].slice(0, 5);
    set({ recentSearches: updated });
    try {
      localStorage.setItem('breeva_recent_searches', JSON.stringify(updated));
    } catch {
      // ignore
    }
  },
}));
