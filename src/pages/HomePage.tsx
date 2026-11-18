import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Crosshair,
  Pause,
  Play,
  Flag,
  X,
  MapPin,
  Navigation,
  Sparkles,
  ChevronRight,
  Menu,
  Bookmark,
  BookmarkCheck,
  Layers,
  UtensilsCrossed,
  Coffee,
  Hotel,
  TreePine,
  ShoppingBag,
  Landmark,
  CreditCard,
  Fuel,
  Clock,
  AlertTriangle,
  RotateCw,
  GraduationCap,
  Route as RouteIcon,
} from 'lucide-react';
import { useMapStore } from '../stores/mapStore';
import { useWalkStore } from '../stores/walkStore';
import { useAuthStore } from '../stores/authStore';
import { useSavedPlacesStore } from '../stores/savedPlacesStore';
import { useIsDark } from '../stores/settingsStore';
import { requestDeviceHeadingPermission } from '../hooks/useDeviceHeading';
// Lazy: defers leaflet (~122KB) + map layers out of the eager main-entry bundle.
const LeafletMap = lazy(() => import('../components/map/LeafletMap'));
const ChatAssistant = lazy(() => import('../components/map/ChatAssistant'));
import SearchBar from '../components/map/SearchBar';
import BottomSheet from '../components/map/BottomSheet';
import RouteCard from '../components/map/RouteCard';
import BottomNavigation from '../components/layout/BottomNavigation';
import HomeStatCards from '../components/features/HomeStatCards';
import Sidebar from '../components/layout/Sidebar';
import TransportModeSelector from '../components/map/TransportModeSelector';
import AQIBadge from '../components/features/AQIBadge';
import AQICard from '../components/features/AQICard';
import WalkComplete from '../components/features/WalkComplete';
import LiveExposureTracker from '../components/features/LiveExposureTracker';
import TurnByTurn from '../components/map/TurnByTurn';
import PlaceDetailSheet from '../components/map/PlaceDetailSheet';
import MapLayersSheet from '../components/map/MapLayersSheet';
import WalkRouteCards from '../components/map/WalkRouteCards';
import SchoolPicker from '../components/map/SchoolPicker';
import type { RouteDest, WalkRoutingState } from '../components/map/WalkRouteLayer';
import type { POI } from '../lib/poi-api';
import type { PollutantType, RoadDisplayMode, SavedPlace } from '../types';
import type { RoadLayerMeta } from '../components/map/RoadPollutionLayer';
import { FIELD_REGIONS, pickRegion, rememberRegion } from '../lib/field/source';
import { parseViewLink } from '../lib/route/share';
import { deviceRouteAsRoute, deviceRouteStart, fieldRegionOf, routeModeFor, transportFor } from '../lib/route/appRoute';
import { pm25ToAQISimple } from '../lib/api';
import { walkEcoPoints } from '../lib/walkPoints';

// Static field build: routes are computed on the device (Web Worker), as on /peta, and only inside field regions.
const FIELD_STATIC = import.meta.env.VITE_FIELD_STATIC === 'true';
const FIELD_REGION_LABELS = FIELD_REGIONS.map((r) => r.label).join(' dan ');

const FILTER_CHIPS = [
  { key: 'restaurant', label: 'Restoran',     icon: UtensilsCrossed, color: '#ef4444' },
  { key: 'cafe',       label: 'Kafe',         icon: Coffee,          color: '#92400e' },
  { key: 'hotel',      label: 'Hotel',        icon: Hotel,           color: '#8b5cf6' },
  { key: 'park',       label: 'Taman',        icon: TreePine,        color: '#16a34a' },
  { key: 'shop',       label: 'Belanja',      icon: ShoppingBag,     color: '#f59e0b' },
  { key: 'mosque',     label: 'Masjid',       icon: Landmark,        color: '#06b6d4' },
  { key: 'atm',        label: 'ATM',          icon: CreditCard,      color: '#6366f1' },
  { key: 'gas',        label: 'SPBU',         icon: Fuel,            color: '#ea580c' },
];

/** Map a Geoapify POI's category hierarchy (e.g. "catering.restaurant") to a SavedPlace category. */
function poiToSavedCategory(poi?: { category?: string; subcategory?: string; types?: string[] } | null): SavedPlace['category'] {
  if (!poi) return 'favorite';
  const hay = [poi.subcategory, ...(poi.types ?? []), poi.category].filter(Boolean).join(' ').toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => hay.includes(k));
  if (has('cafe', 'coffee')) return 'cafe';
  if (has('restaurant', 'fast_food', 'food_court', 'catering', 'bar', 'pub', 'food')) return 'food';
  if (has('accommodation', 'hotel', 'hostel', 'motel', 'guest_house')) return 'hotel';
  if (has('mosque')) return 'mosque';
  if (has('church', 'christian', 'cathedral', 'chapel')) return 'church';
  if (has('park', 'garden')) return 'park';
  if (has('fitness', 'sports_centre', 'gym', 'sport')) return 'gym';
  if (has('school', 'university', 'college', 'kindergarten', 'education')) return 'school';
  if (has('hospital', 'clinic', 'pharmacy', 'doctors', 'healthcare')) return 'hospital';
  if (has('museum', 'monument', 'attraction', 'tourism', 'viewpoint', 'artwork', 'memorial', 'landmark')) return 'landmark';
  if (has('public_transport', 'railway', 'airport', 'bus_stop', 'subway', 'station', 'transport')) return 'transport';
  if (has('commercial', 'supermarket', 'mall', 'marketplace', 'shop', 'store')) return 'shop';
  return 'favorite';
}

export default function HomePage() {
  const {
    userLocation,
    destination,
    destinationName,
    routes,
    selectedRoute,
    isCalculatingRoutes,
    currentAQI,
    transportMode,
    startLocating,
    stopLocating,
    calculateRoutes,
    selectRoute,
    clearDestination,
    setDestination,
    setBottomSheetState,
    setCenter,
    center,
  } = useMapStore();

  const {
    isTracking,
    isPaused,
    distanceMeters,
    durationSeconds,
    pointsEarned,
    session: walkSession,
    exposureResult,
    currentPosition,
    navProgress,
    arrived,
    offRoute,
    startWalk,
    pauseWalk,
    resumeWalk,
    endWalk,
    cancelWalk,
  } = useWalkStore();

  const { profile, user } = useAuthStore();
  const { addPlace, isPlaceSaved } = useSavedPlacesStore();
  const location = useLocation();
  // Dark mode comes from the unified settings store (reactive); applyTheme() keeps
  // the <html> class in lockstep, so no DOM polling is needed.
  const isDark = useIsDark();
  const [showWalkComplete, setShowWalkComplete] = useState(false);
  // ?pusat=lat,lng,zoom: the zoom of that view (the store starts at its centre)
  const [startZoom] = useState(() => parseViewLink(window.location.search)?.zoom);
  // Road colours are on by default: the map is the product (F1-02).
  const [showAQIOverlay, setShowAQIOverlay] = useState(true);
  const [showAQIStations, setShowAQIStations] = useState(false);
  const [showPOIs, setShowPOIs] = useState(true);
  const [highlightGreen, setHighlightGreen] = useState(false);
  const [pollutant, setPollutant] = useState<PollutantType>('aqi');
  const [forecastHour, setForecastHour] = useState(0);
  // 'traffic' (default) = the per-road traffic part (CALINE4 dispersion) on a fixed scale with a dead band;
  // 'total' = absolute pollutant level vs WHO/EPA bands, where nearly every road gets the same colour.
  const [roadDisplayMode, setRoadDisplayMode] = useState<RoadDisplayMode>('traffic');
  const [roadLayerMeta, setRoadLayerMeta] = useState<RoadLayerMeta | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<'voyager' | 'osm' | 'satellite'>('voyager');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [showLayersSheet, setShowLayersSheet] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // ── On-device routes (F1-18): same engine as /peta, inside the field regions only ──
  const destRegion = FIELD_STATIC ? fieldRegionOf(destination) : null;
  const destKey = destination ? `${destination.lat},${destination.lng}` : '';
  // the destination the route button was pressed for; a new destination needs a new press
  const [routedKey, setRoutedKey] = useState<string | null>(null);
  const deviceRouting = !!destRegion && routedKey === destKey && !isTracking;
  const [walkState, setWalkState] = useState<WalkRoutingState | null>(null);
  const [routeMode, setRouteMode] = useState<'walk' | 'motor'>(() => routeModeFor(transportMode));
  const [depart, setDepart] = useState<string | null>(null);
  const routeDest: RouteDest | null = destination && destRegion
    ? { lat: destination.lat, lng: destination.lng, name: destinationName || 'Tujuan' }
    : null;
  // GPS start when it lies in the destination's region; otherwise the user taps the start on the map
  const routeStart = deviceRouteStart(userLocation, destination);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [schoolRegionName, setSchoolRegionName] = useState<string | null>(null);
  const schoolRegion = schoolRegionName ? pickRegion(schoolRegionName) : fieldRegionOf(userLocation) ?? fieldRegionOf(center) ?? FIELD_REGIONS[0];

  const findDeviceRoutes = () => {
    setWalkState(null);
    setRoutedKey(destKey);
  };

  // Walk along one on-device route: it becomes the selected route, so the tracking UI (progress, remaining distance,
  // arrival) follows its polyline. No turn-by-turn: the device graph has no instructions.
  const startDeviceWalk = (k: number) => {
    const r = walkState?.routes?.[k];
    if (!r) return;
    const avgAqi = pm25ToAQISimple(r.pm25Mean);
    const last = (walkState?.routes?.length ?? 1) - 1;
    const route = deviceRouteAsRoute(r, {
      id: crypto.randomUUID(), userId: user?.id ?? 'guest', cleanest: k === last && k > 0, avgAqi, points: walkEcoPoints(r.lengthM, avgAqi),
    });
    useMapStore.setState({ routes: [route], selectedRoute: route });
    void requestDeviceHeadingPermission();
    startWalk(route.id, transportFor(routeMode), { routePm25: r.pm25Mean });
  };

  useEffect(() => {
    startLocating();
    return () => stopLocating();
  }, [startLocating, stopLocating]);

  // A walk along an on-device route ended (finished, too short or cancelled): drop that route from the map store, so the
  // sheet shows the on-device route cards again instead of the server route list.
  const wasTrackingRef = useRef(false);
  useEffect(() => {
    if (FIELD_STATIC && wasTrackingRef.current && !isTracking) useMapStore.setState({ routes: [], selectedRoute: null });
    wasTrackingRef.current = isTracking;
  }, [isTracking]);

  // Consume a destination handed off via router state (e.g. "Rute" from Saved Places).
  useEffect(() => {
    const st = location.state as { destination?: { lat: number; lng: number }; destinationName?: string } | null;
    if (st?.destination) {
      setDestination(st.destination, st.destinationName);
      setCenter(st.destination);
      // Clear so a back-nav or refresh doesn't re-apply the stale destination.
      window.history.replaceState({}, '');
    }
  }, [location.state, setDestination, setCenter]);

  const handleEndWalk = async () => {
    const completed = await endWalk();
    if (completed) {
      setShowWalkComplete(true);
    }
  };

  // Auto-arrival: walkStore latches `arrived` within 30 m of the destination —
  // finish the walk + open the celebration modal automatically.
  useEffect(() => {
    if (!arrived || !isTracking) return;
    toast('Kamu sudah sampai! 🎉', { icon: '📍' });
    (async () => {
      const completed = await endWalk();
      if (completed) setShowWalkComplete(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, isTracking]);

  // Off-route → reroute from the current position (debounced so a brief detour
  // doesn't spam recalculations). walkStore sets `offRoute` past a 30 m threshold.
  const rerouteAtRef = useRef(0);
  useEffect(() => {
    // Static field build: routes are on the device only; no server reroute (the warning still shows).
    if (FIELD_STATIC || !isTracking || !offRoute || !destination) return;
    const now = Date.now();
    if (now - rerouteAtRef.current < 20000) return;
    rerouteAtRef.current = now;
    toast('Keluar dari rute — menghitung ulang…', { icon: '🧭' });
    calculateRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offRoute, isTracking, destination]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Human ETA ("12 mnt", "1 jam 5 mnt") + remaining distance ("350 m", "1,2 km").
  const formatEta = (seconds: number) => {
    const mins = Math.max(0, Math.round(seconds / 60));
    if (mins < 1) return '<1 mnt';
    if (mins < 60) return `${mins} mnt`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} jam ${m} mnt` : `${h} jam`;
  };
  const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Map (lazy — defers leaflet out of the main entry; base layer paints under the skeleton) */}
      <Suspense fallback={<div className="absolute inset-0 bg-gray-100 dark:bg-gray-900 animate-pulse" />}>
        <LeafletMap
          className="absolute inset-0"
          isDarkMode={isDark}
          showAQIOverlay={showAQIOverlay}
          showAQIStations={showAQIStations}
          showPOIs={showPOIs}
          highlightGreen={highlightGreen}
          mapStyle={mapStyle}
          activeFilter={activeFilter}
          pollutant={pollutant}
          forecastHour={forecastHour}
          roadDisplayMode={roadDisplayMode}
          onRoadLayerMeta={setRoadLayerMeta}
          onPlaceSelect={(poi) => setSelectedPOI(poi)}
          selectedPoiId={selectedPOI?.id ?? null}
          walkRouting={deviceRouting}
          onWalkRouting={setWalkState}
          routeMode={routeMode}
          routeDest={routeDest}
          routeDepart={depart}
          routeStart={routeStart}
          initialZoom={startZoom}
        />
      </Suspense>

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* ============ NON-TRACKING UI ============ */}
      {!isTracking && (
        <>
          {/* Top header bar */}
          <div className="absolute top-0 left-0 right-0 z-30 safe-area-top">
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 max-w-2xl mx-auto">
                {/* Hamburger menu */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Buka menu"
                  className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white dark:bg-gray-900/70 backdrop-blur-xl border border-gray-200 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                >
                  <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300" strokeWidth={1.8} />
                </button>

                {/* Search bar */}
                <div className="flex-1 min-w-0">
                  <SearchBar
                    onPlaceSelect={(poi) => setSelectedPOI(poi)}
                    filterChips={FILTER_CHIPS}
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                  />
                </div>

                {/* Profile avatar */}
                <a href="/profile" className="relative flex-shrink-0 group">
                  <span className="sr-only">Profil,</span>
                  <div className="w-11 h-11 rounded-2xl overflow-hidden bg-white dark:bg-gray-900/70 backdrop-blur-xl border border-gray-200 dark:border-gray-700/50 shadow-sm group-hover:shadow-md transition-all">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full gradient-primary flex items-center justify-center text-white text-sm font-bold">
                        {profile?.full_name?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm border border-white dark:border-gray-900">
                    {profile?.ecopoints_balance || 0}
                  </div>
                  <span className="sr-only">EcoPoints</span>
                </a>
              </div>

              {/* Headline AQI lives in the bottom AQICard now — headbar badge removed to avoid duplication. */}

              {/* Screen-reader live region: announces air-quality changes to assistive tech */}
              <div className="sr-only" role="status" aria-live="polite">
                {currentAQI ? `Kualitas udara saat ini: AQI ${Math.round(currentAQI.aqi)}, ${currentAQI.level.replace(/-/g, ' ')}` : ''}
              </div>

              {/* Active filter pill */}
              {activeFilter && (() => {
                const chip = FILTER_CHIPS.find(c => c.key === activeFilter);
                if (!chip) return null;
                const Icon = chip.icon;
                return (
                  <div className="mt-2 max-w-2xl mx-auto">
                    <button
                      onClick={() => setActiveFilter(null)}
                      className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-medium text-white transition-all"
                      style={{ backgroundColor: chip.color, boxShadow: `0 2px 8px ${chip.color}40` }}
                    >
                      <Icon className="w-3 h-3" strokeWidth={2} />
                      <span>{chip.label}</span>
                      <X className="w-3 h-3 ml-0.5 opacity-80" strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Right side controls */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2">
            {/* Layers button */}
            <button
              onClick={() => setShowLayersSheet(true)}
              className="w-10 h-10 rounded-xl glass-card flex items-center justify-center shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-gray-600 dark:text-gray-400"
              title="Lapisan peta"
              aria-label="Lapisan peta"
            >
              <Layers className="w-4.5 h-4.5" />
            </button>

            {/* Re-center button */}
            {userLocation && (
              <button
                onClick={() => setCenter(userLocation)}
                aria-label="Pusatkan ke lokasiku"
                className="w-10 h-10 rounded-xl glass-card flex items-center justify-center shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-primary-600 dark:text-primary-400"
              >
                <Crosshair className="w-4.5 h-4.5" />
              </button>
            )}

            {/* Vayu AI assistant button (3rd, always visible — bottom of the stack) */}
            <button
              onClick={() => setShowChat(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md ring-1 ring-white/50 hover:shadow-lg hover:scale-105 active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg,#10b981,#14b8a6,#06b6d4)', boxShadow: '0 4px 14px -2px rgba(20,184,166,0.5)' }}
              title="Tanya Vayu"
              aria-label="Tanya Vayu — asisten udara"
            >
              <Sparkles className="w-4.5 h-4.5" strokeWidth={2.2} />
            </button>
          </div>
        </>
      )}

      {/* ============ ACTIVE WALK TRACKING UI ============ */}
      {isTracking && (
        <>
          {/* Minimal header */}
          <div className="absolute top-0 left-0 right-0 z-30 safe-area-top">
            <div className="px-4 pt-3 pb-2">
              <div className="max-w-2xl mx-auto flex items-center justify-between bg-white dark:bg-gray-900/80 backdrop-blur-xl rounded-2xl px-4 py-2.5 border border-gray-200 dark:border-gray-700/40 shadow-lg">
                <button
                  onClick={cancelWalk}
                  className="text-sm text-red-500 font-medium flex items-center gap-1 hover:text-red-600 transition"
                >
                  <X className="w-4 h-4" />
                  Batal
                </button>
                <div className="text-center">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">Menuju</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[180px]">
                    {destinationName || 'Tujuan'}
                  </p>
                </div>
                <button
                  onClick={handleEndWalk}
                  className="text-sm text-primary-600 font-semibold flex items-center gap-1 hover:text-primary-700 transition"
                >
                  <Flag className="w-4 h-4" />
                  Selesai
                </button>
              </div>
            </div>

            {/* Off-route warning — visible the moment you stray >30 m from the line */}
            <AnimatePresence>
              {(offRoute || isCalculatingRoutes) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="px-4 mt-2 max-w-2xl mx-auto"
                >
                  <div className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5 shadow-lg bg-amber-500 text-white">
                    {isCalculatingRoutes ? (
                      <RotateCw className="w-4 h-4 flex-shrink-0 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <p className="text-sm font-semibold flex-1">
                      {isCalculatingRoutes ? 'Menghitung ulang rute…' : 'Kamu keluar dari rute'}
                    </p>
                    {offRoute && !isCalculatingRoutes && !FIELD_STATIC && (
                      <button
                        onClick={() => { rerouteAtRef.current = Date.now(); calculateRoutes(); }}
                        className="text-xs font-bold bg-white/25 hover:bg-white/35 rounded-full px-3 py-1 transition"
                      >
                        Rute ulang
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Turn-by-turn directions */}
            {selectedRoute && selectedRoute.instructions?.length > 0 && (
              <div className="px-4 mt-2 max-w-2xl mx-auto">
                <TurnByTurn
                  instructions={selectedRoute.instructions}
                  currentPosition={currentPosition ?? userLocation}
                  routeWaypoints={selectedRoute.waypoints}
                />
              </div>
            )}
          </div>

          {/* Walk stats panel */}
          <div className="absolute bottom-6 left-0 right-0 z-30 px-4">
            <div className="max-w-2xl mx-auto">
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-5 border border-gray-200 dark:border-gray-700/40 shadow-xl">
                {/* Progress bar — snapped route progress when available */}
                {selectedRoute && (
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mb-3 overflow-hidden">
                    <motion.div
                      className="h-full gradient-primary rounded-full"
                      animate={{
                        width: `${Math.min((navProgress?.fraction ?? (distanceMeters / selectedRoute.distance_meters)) * 100, 100)}%`,
                      }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                )}

                {/* ETA + remaining distance */}
                {navProgress && selectedRoute && (
                  <div className="flex items-center justify-center gap-2.5 mb-3 text-xs">
                    <span className="inline-flex items-center gap-1 font-bold text-gray-900 dark:text-white">
                      <Clock className="w-3.5 h-3.5 text-primary-500" />
                      {formatEta(navProgress.etaSeconds)}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">•</span>
                    <span className="text-gray-500 dark:text-gray-400">{formatDistance(navProgress.metersRemaining)} tersisa</span>
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center justify-around mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                      {(distanceMeters / 1000).toFixed(2)}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">km</p>
                  </div>
                  <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                      {formatTime(durationSeconds)}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">waktu</p>
                  </div>
                  <div className="w-px h-10 bg-gray-200 dark:bg-gray-700" />
                  <div className="text-center">
                    <motion.p
                      key={pointsEarned}
                      initial={{ scale: 1.3, color: '#f59e0b' }}
                      animate={{ scale: 1, color: undefined }}
                      className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums"
                    >
                      {pointsEarned}
                    </motion.p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">poin</p>
                  </div>
                </div>

                {/* Control buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={isPaused ? resumeWalk : pauseWalk}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {isPaused ? 'Lanjut' : 'Jeda'}
                  </button>
                  <button
                    onClick={handleEndWalk}
                    className="flex-1 gradient-primary text-white py-3 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Flag className="w-4 h-4" />
                    Akhiri
                  </button>
                </div>

                {/* AQI during walk */}
                {currentAQI && (
                  <div className="mt-3 flex items-center justify-center">
                    <AQIBadge aqi={currentAQI.aqi} size="sm" confidence={currentAQI.confidence} />
                  </div>
                )}

                {/* Live exposure tracker */}
                <LiveExposureTracker
                  currentAQI={currentAQI?.aqi ?? null}
                  durationSeconds={durationSeconds}
                  isPaused={isPaused}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============ BOTTOM SHEET (non-tracking) ============ */}
      {!isTracking && (
        <BottomSheet>
          {/* === No destination — home state === */}
          {!destination && (
            <div>
              {/* Quick stats — live data (quests/streak/rank) + tappable to detail */}
              <HomeStatCards />

              {/* AQI summary card */}
              {currentAQI && (
                <div className="mb-4">
                  <AQICard
                    data={currentAQI}
                    onExpandChange={(exp) => {
                      if (exp) setBottomSheetState('half');
                    }}
                  />
                </div>
              )}

              {/* "Ke sekolah": a school from the region's list is the destination, routed on the device (F1-12, F1-18) */}
              {FIELD_STATIC && (
                <div className="mb-3">
                  <button
                    onClick={() => { setSchoolOpen((o) => !o); setBottomSheetState('half'); }}
                    aria-expanded={schoolOpen}
                    className="w-full flex items-center gap-2.5 rounded-2xl border border-teal-200 dark:border-teal-800/50 bg-teal-50/80 dark:bg-teal-900/20 px-4 py-3 text-sm font-semibold text-teal-800 dark:text-teal-200"
                  >
                    <GraduationCap className="w-5 h-5 shrink-0" />
                    Ke sekolah
                    <span className="ml-auto text-[11px] font-medium text-teal-700/80 dark:text-teal-300/80">rute bersih di perangkat</span>
                  </button>
                  {schoolOpen && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Wilayah">
                        {FIELD_REGIONS.map((r) => (
                          <button key={r.name} aria-pressed={schoolRegion.name === r.name}
                            onClick={() => { setSchoolRegionName(r.name); rememberRegion(r.name); setCenter(r.home); }}
                            className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${schoolRegion.name === r.name ? 'bg-sky-700 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <SchoolPicker region={schoolRegion} value={null} onChange={(d) => {
                        if (!d) return;
                        setSchoolOpen(false);
                        void setDestination({ lat: d.lat, lng: d.lng }, d.name);
                        setWalkState(null);
                        setRoutedKey(`${d.lat},${d.lng}`);
                      }} />
                    </div>
                  )}
                </div>
              )}

              {/* Start a walk CTA: a walk starts from a destination, so it opens the search */}
              <button
                onClick={() => { setBottomSheetState('half'); document.getElementById('search-input')?.focus(); }}
                className="w-full gradient-primary text-white py-4 rounded-2xl text-base font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
              >
                <Play className="w-5 h-5 fill-current" />
                Mulai
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
              <p className="mt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">Cari tujuan di kolom atas atau ketuk peta.</p>
            </div>
          )}

          {/* === Destination selected — show route options === */}
          {/* (static field build: mapStore.routes only ever holds the on-device route of a walk) */}
          {destination && (FIELD_STATIC || !routes.length) && !isCalculatingRoutes && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">Rute ke</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[180px]">
                      {destinationName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (destination && destinationName) {
                        if (isPlaceSaved(destination)) return;
                        addPlace(destinationName, destination, 'favorite');
                      }
                    }}
                    className={`p-2 rounded-xl transition-colors ${
                      destination && isPlaceSaved(destination)
                        ? 'text-amber-500'
                        : 'text-gray-400 dark:text-gray-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                    }`}
                    title="Simpan tempat"
                    aria-label="Simpan tempat"
                  >
                    {destination && isPlaceSaved(destination) ? (
                      <BookmarkCheck className="w-4.5 h-4.5" />
                    ) : (
                      <Bookmark className="w-4.5 h-4.5" />
                    )}
                  </button>
                  <button
                    onClick={clearDestination}
                    aria-label="Hapus tujuan"
                    className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {FIELD_STATIC ? (
                destRegion ? (
                  deviceRouting ? (
                    /* Routes computed on the device (same engine and cards as /peta) */
                    <div className="space-y-2">
                      <WalkRouteCards state={walkState} mode={routeMode} onMode={setRouteMode} depart={depart} onDepart={setDepart} />
                      {!!walkState?.routes?.length && (
                        <div className="grid gap-2">
                          {walkState.cards.map((c, k) => (
                            <button
                              key={c.index}
                              onClick={() => startDeviceWalk(k)}
                              className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-md transition active:scale-[0.99]"
                              style={{ background: c.color }}
                            >
                              <Play className="w-4 h-4 fill-current shrink-0" />
                              <span className="truncate">Mulai: {c.label}</span>
                              <span className="ml-auto shrink-0 text-xs opacity-90">
                                {c.minutes} mnt{routeMode === 'walk' && walkState.routes ? ` · +${walkEcoPoints(walkState.routes[k].lengthM, pm25ToAQISimple(walkState.routes[k].pm25Mean))} poin` : ''}
                              </span>
                            </button>
                          ))}
                          {routeMode === 'motor' && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">EcoPoin hanya untuk jalan kaki; perjalanan motor dilacak tanpa poin.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {/* Modes with an on-device graph: walking and motorbike (no cycle, e-bike or car here) */}
                      <div className="mb-3 flex gap-2" role="group" aria-label="Moda">
                        {(['walk', 'motor'] as const).map((m) => (
                          <button key={m} onClick={() => setRouteMode(m)} aria-pressed={routeMode === m}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${routeMode === m ? 'bg-teal-700 text-white shadow-sm' : 'bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'}`}>
                            {m === 'walk' ? 'Jalan kaki' : 'Motor'}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={findDeviceRoutes}
                        className="w-full gradient-primary text-white py-3.5 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2"
                      >
                        <Navigation className="w-4 h-4" />
                        Cari rute bersih
                      </button>
                      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                        Dihitung di perangkat dari peta udara per jalan {destRegion.label}, tanpa server.{' '}
                        {routeStart ? 'Berangkat dari lokasimu sekarang.' : 'Setelah itu ketuk titik berangkat di peta.'}
                      </p>
                    </div>
                  )
                ) : (
                  /* Outside the field regions there is no per-road air map: no guessed route */
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/80 dark:bg-amber-900/20 p-4" role="status">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                      <RouteIcon className="w-4 h-4 shrink-0" /> Rute bersih baru tersedia di {FIELD_REGION_LABELS}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                      Di luar dua wilayah itu peta belum punya data udara per jalan, jadi Breeva tidak menghitung rute di sini.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {FIELD_REGIONS.map((r) => (
                        <button key={r.name} onClick={() => { clearDestination(); setCenter(r.home); }}
                          className="rounded-full bg-white/90 dark:bg-gray-900/60 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800/60">
                          Lihat {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <>
                  {/* Transport mode selector */}
                  <div className="mb-3">
                    <TransportModeSelector />
                  </div>

                  <button
                    onClick={calculateRoutes}
                    className="w-full gradient-primary text-white py-3.5 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2"
                  >
                    <Navigation className="w-4 h-4" />
                    Cari rute
                  </button>
                </>
              )}
            </div>
          )}

          {/* === Calculating routes === */}
          {isCalculatingRoutes && (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Mencari rute terbaik…</p>
            </div>
          )}

          {/* === Route selection === */}
          {routes.length > 0 && !FIELD_STATIC && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                  Pilih rute
                </h3>
                <button
                  onClick={clearDestination}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Transport mode selector */}
              <div className="mb-3">
                <TransportModeSelector />
              </div>

              <div className="flex flex-col gap-2.5 mb-4">
                {routes.map((route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    isSelected={selectedRoute?.id === route.id}
                    onSelect={() => selectRoute(route)}
                    isRecommended={route.route_type === 'eco'}
                  />
                ))}
              </div>

              {/* Gemini AI reasoning card */}
              {selectedRoute?.gemini_reasoning && (
                <div className="mb-3 p-3 rounded-xl bg-violet-50/80 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">Analisis rute AI</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    {selectedRoute.gemini_reasoning}
                  </p>
                </div>
              )}

              {/* Start walking CTA */}
              {selectedRoute && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <button
                    onClick={() => { void requestDeviceHeadingPermission(); startWalk(selectedRoute.id, transportMode); }}
                    className="w-full gradient-primary text-white py-4 rounded-2xl text-base font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    Mulai
                    <span className="text-xs opacity-75 ml-1">
                      {Math.round(selectedRoute.duration_seconds / 60)} mnt · +{selectedRoute.eco_points_earned} poin
                    </span>
                  </button>
                </motion.div>
              )}
            </div>
          )}
        </BottomSheet>
      )}

      {/* Bottom Navigation */}
      {!isTracking && <BottomNavigation />}

      {/* Place Detail Sheet */}
      <PlaceDetailSheet
        poi={selectedPOI}
        onClose={() => setSelectedPOI(null)}
        onNavigate={(coord, name) => {
          setDestination(coord, name);
          setSelectedPOI(null);
        }}
        onSave={(name, coord) => {
          if (!isPlaceSaved(coord)) addPlace(name, coord, poiToSavedCategory(selectedPOI));
        }}
        isSaved={selectedPOI ? isPlaceSaved(selectedPOI.coordinate) : false}
        userLocation={userLocation}
      />

      {/* Map Layers Sheet */}
      {showChat && (
        <Suspense fallback={null}>
          <ChatAssistant onClose={() => setShowChat(false)} />
        </Suspense>
      )}

      <MapLayersSheet
        isOpen={showLayersSheet}
        onClose={() => setShowLayersSheet(false)}
        mapStyle={mapStyle}
        onMapStyleChange={setMapStyle}
        showAQIOverlay={showAQIOverlay}
        onAQIOverlayToggle={() => setShowAQIOverlay(!showAQIOverlay)}
        showAQIStations={showAQIStations}
        onAQIStationsToggle={() => setShowAQIStations(!showAQIStations)}
        showPOIs={showPOIs}
        onPOIsToggle={() => setShowPOIs(!showPOIs)}
        showGreenHighlight={highlightGreen}
        onGreenHighlightToggle={() => setHighlightGreen(!highlightGreen)}
        currentAQI={currentAQI}
        pollutant={pollutant}
        onPollutantChange={setPollutant}
        forecastHour={forecastHour}
        onForecastHourChange={setForecastHour}
        roadDisplayMode={roadDisplayMode}
        onRoadDisplayModeChange={setRoadDisplayMode}
        roadLayerMeta={roadLayerMeta}
      />

      {/* Walk Complete modal */}
      <AnimatePresence>
        {showWalkComplete && walkSession && walkSession.status === 'completed' && (
          <WalkComplete
            session={walkSession}
            onClose={() => {
              setShowWalkComplete(false);
              clearDestination();
            }}
            exposureResult={exposureResult}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
