import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Crosshair,
  Pause,
  Play,
  Flag,
  X,
  MapPin,
  Navigation,
  Sparkles,
  Flame,
  Trophy,
  Footprints,
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
} from 'lucide-react';
import { useMapStore } from '../stores/mapStore';
import { useWalkStore } from '../stores/walkStore';
import { useAuthStore } from '../stores/authStore';
import { useSavedPlacesStore } from '../stores/savedPlacesStore';
import LeafletMap from '../components/map/LeafletMap';
import SearchBar from '../components/map/SearchBar';
import BottomSheet from '../components/map/BottomSheet';
import RouteCard from '../components/map/RouteCard';
import BottomNavigation from '../components/layout/BottomNavigation';
import Sidebar from '../components/layout/Sidebar';
import TransportModeSelector from '../components/map/TransportModeSelector';
import AQIBadge from '../components/features/AQIBadge';
import AQICard from '../components/features/AQICard';
import WalkComplete from '../components/features/WalkComplete';
import LiveExposureTracker from '../components/features/LiveExposureTracker';
import TurnByTurn from '../components/map/TurnByTurn';
import PlaceDetailSheet from '../components/map/PlaceDetailSheet';
import MapLayersSheet from '../components/map/MapLayersSheet';
import type { POI } from '../lib/poi-api';
import type { PollutantType } from '../types';
import type { RoadLayerMeta } from '../components/map/RoadPollutionLayer';

const FILTER_CHIPS = [
  { key: 'restaurant', label: 'Restaurants', icon: UtensilsCrossed, color: '#ef4444' },
  { key: 'cafe',       label: 'Cafes',       icon: Coffee,          color: '#92400e' },
  { key: 'hotel',      label: 'Hotels',       icon: Hotel,           color: '#8b5cf6' },
  { key: 'park',       label: 'Parks',        icon: TreePine,        color: '#16a34a' },
  { key: 'shop',       label: 'Shopping',     icon: ShoppingBag,     color: '#f59e0b' },
  { key: 'mosque',     label: 'Mosques',      icon: Landmark,        color: '#06b6d4' },
  { key: 'atm',        label: 'ATMs',         icon: CreditCard,      color: '#6366f1' },
  { key: 'gas',        label: 'Gas',          icon: Fuel,            color: '#ea580c' },
];

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
  } = useMapStore();

  const {
    isTracking,
    isPaused,
    distanceMeters,
    durationSeconds,
    pointsEarned,
    session: walkSession,
    exposureResult,
    startWalk,
    pauseWalk,
    resumeWalk,
    endWalk,
    cancelWalk,
  } = useWalkStore();

  const { profile } = useAuthStore();
  const { addPlace, isPlaceSaved } = useSavedPlacesStore();
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
  const [showWalkComplete, setShowWalkComplete] = useState(false);
  const [showAQIOverlay, setShowAQIOverlay] = useState(false);
  const [showAQIStations, setShowAQIStations] = useState(false);
  const [showPOIs, setShowPOIs] = useState(true);
  const [pollutant, setPollutant] = useState<PollutantType>('aqi');
  const [forecastHour, setForecastHour] = useState(0);
  const [roadLayerMeta, setRoadLayerMeta] = useState<RoadLayerMeta | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<'voyager' | 'osm' | 'satellite'>('voyager');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [showLayersSheet, setShowLayersSheet] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    startLocating();
    return () => stopLocating();
  }, [startLocating, stopLocating]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const handleEndWalk = async () => {
    const completed = await endWalk();
    if (completed) {
      setShowWalkComplete(true);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Map */}
      <LeafletMap
        className="absolute inset-0"
        isDarkMode={isDark}
        showAQIOverlay={showAQIOverlay}
        showAQIStations={showAQIStations}
        showPOIs={showPOIs}
        mapStyle={mapStyle}
        activeFilter={activeFilter}
        pollutant={pollutant}
        forecastHour={forecastHour}
        onRoadLayerMeta={setRoadLayerMeta}
        onPlaceSelect={(poi) => setSelectedPOI(poi)}
      />

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
                  className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white dark:bg-gray-900/70 backdrop-blur-xl border border-gray-200 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                >
                  <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300" strokeWidth={1.8} />
                </button>

                {/* Search bar */}
                <div className="flex-1">
                  <SearchBar
                    onPlaceSelect={(poi) => setSelectedPOI(poi)}
                    filterChips={FILTER_CHIPS}
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                  />
                </div>

                {/* Profile avatar */}
                <a href="/profile" className="relative flex-shrink-0 group">
                  <div className="w-11 h-11 rounded-2xl overflow-hidden bg-white dark:bg-gray-900/70 backdrop-blur-xl border border-gray-200 dark:border-gray-700/50 shadow-sm group-hover:shadow-md transition-all">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full gradient-primary flex items-center justify-center text-white text-sm font-bold">
                        {profile?.name?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm border border-white dark:border-gray-900">
                    {profile?.ecopoints_balance || 0}
                  </div>
                </a>
              </div>

              {/* AQI badge */}
              {currentAQI && (
                <div className="mt-2 max-w-2xl mx-auto">
                  <AQIBadge aqi={currentAQI.aqi} size="sm" confidence={currentAQI.confidence} />
                </div>
              )}

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
              title="Map layers"
            >
              <Layers className="w-4.5 h-4.5" />
            </button>

            {/* Re-center button */}
            {userLocation && (
              <button
                onClick={() => setCenter(userLocation)}
                className="w-10 h-10 rounded-xl glass-card flex items-center justify-center shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all text-primary-600 dark:text-primary-400"
              >
                <Crosshair className="w-4.5 h-4.5" />
              </button>
            )}
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
                  Cancel
                </button>
                <div className="text-center">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">Walking to</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[180px]">
                    {destinationName || 'Destination'}
                  </p>
                </div>
                <button
                  onClick={handleEndWalk}
                  className="text-sm text-primary-600 font-semibold flex items-center gap-1 hover:text-primary-700 transition"
                >
                  <Flag className="w-4 h-4" />
                  Finish
                </button>
              </div>
            </div>

            {/* Turn-by-turn directions */}
            {selectedRoute && selectedRoute.instructions?.length > 0 && (
              <div className="px-4 mt-2 max-w-2xl mx-auto">
                <TurnByTurn
                  instructions={selectedRoute.instructions}
                  currentPosition={userLocation}
                  routeWaypoints={selectedRoute.waypoints}
                />
              </div>
            )}
          </div>

          {/* Walk stats panel */}
          <div className="absolute bottom-6 left-0 right-0 z-30 px-4">
            <div className="max-w-2xl mx-auto">
              <div className="bg-white dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl p-5 border border-gray-200 dark:border-gray-700/40 shadow-xl">
                {/* Progress bar */}
                {selectedRoute && (
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mb-4 overflow-hidden">
                    <motion.div
                      className="h-full gradient-primary rounded-full"
                      style={{
                        width: `${Math.min((distanceMeters / selectedRoute.distance_meters) * 100, 100)}%`,
                      }}
                    />
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
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">time</p>
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
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">points</p>
                  </div>
                </div>

                {/* Control buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={isPaused ? resumeWalk : pauseWalk}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={handleEndWalk}
                    className="flex-1 gradient-primary text-white py-3 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Flag className="w-4 h-4" />
                    End Walk
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
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <div className="bg-primary-50/80 dark:bg-primary-950/30 rounded-2xl p-3.5 text-center border border-primary-100/50 dark:border-primary-800/20">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-primary-500" />
                    <p className="text-lg font-bold text-primary-600 dark:text-primary-400 tabular-nums">0/3</p>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Quests</p>
                </div>
                <div className="bg-amber-50/80 dark:bg-amber-950/30 rounded-2xl p-3.5 text-center border border-amber-100/50 dark:border-amber-800/20">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Flame className="w-3.5 h-3.5 text-amber-500" />
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      {profile?.current_streak || 0}
                    </p>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Streak</p>
                </div>
                <div className="bg-blue-50/80 dark:bg-blue-950/30 rounded-2xl p-3.5 text-center border border-blue-100/50 dark:border-blue-800/20">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Trophy className="w-3.5 h-3.5 text-blue-500" />
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">#--</p>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Rank</p>
                </div>
              </div>

              {/* AQI summary card */}
              {currentAQI && (
                <div className="mb-4">
                  <AQICard data={currentAQI} />
                </div>
              )}

              {/* Start a walk CTA */}
              <button
                onClick={() => setBottomSheetState('half')}
                className="w-full gradient-primary text-white py-4 rounded-2xl text-base font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
              >
                <Footprints className="w-5 h-5" />
                Start a Walk
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
            </div>
          )}

          {/* === Destination selected — show route options === */}
          {destination && !routes.length && !isCalculatingRoutes && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">Navigate to</p>
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
                    title="Save place"
                  >
                    {destination && isPlaceSaved(destination) ? (
                      <BookmarkCheck className="w-4.5 h-4.5" />
                    ) : (
                      <Bookmark className="w-4.5 h-4.5" />
                    )}
                  </button>
                  <button
                    onClick={clearDestination}
                    className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Transport mode selector */}
              <div className="mb-3">
                <TransportModeSelector />
              </div>

              <button
                onClick={calculateRoutes}
                className="w-full gradient-primary text-white py-3.5 rounded-2xl text-sm font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2"
              >
                <Navigation className="w-4 h-4" />
                Get Routes
              </button>
            </div>
          )}

          {/* === Calculating routes === */}
          {isCalculatingRoutes && (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Finding best routes...</p>
            </div>
          )}

          {/* === Route selection === */}
          {routes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                  Choose Your Route
                </h3>
                <button
                  onClick={clearDestination}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 transition-colors"
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

              {/* Start walking CTA */}
              {selectedRoute && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <button
                    onClick={() => startWalk(selectedRoute.id, transportMode)}
                    className="w-full gradient-primary text-white py-4 rounded-2xl text-base font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5"
                  >
                    <Footprints className="w-5 h-5" />
                    Start Walking
                    <span className="text-xs opacity-75 ml-1">
                      {Math.round(selectedRoute.duration_seconds / 60)} min · +{selectedRoute.eco_points_earned} pts
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
          if (!isPlaceSaved(coord)) addPlace(name, coord, 'favorite');
        }}
        isSaved={selectedPOI ? isPlaceSaved(selectedPOI.coordinate) : false}
        userLocation={userLocation}
      />

      {/* Map Layers Sheet */}
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
        currentAQI={currentAQI}
        pollutant={pollutant}
        onPollutantChange={setPollutant}
        forecastHour={forecastHour}
        onForecastHourChange={setForecastHour}
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
