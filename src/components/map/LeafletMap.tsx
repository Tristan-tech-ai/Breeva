import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';
import { LocateFixed, Compass, Navigation } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { useWalkStore } from '../../stores/walkStore';
import { lookAheadPoint, routeProgress, splitPathAtFraction } from '../../lib/geo';
import { useRoadPollutionLayer } from './RoadPollutionLayer';
import { useRoadMvtLayer } from './RoadMvtLayer';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { useAQIStationLayer } from './AQIStationLayer';
import POILayer from './POILayer';
import { GCNConfidenceLegend } from './GCNConfidenceLegend';
import type { POI } from '../../lib/poi-api';
import type { Coordinate, Route } from '../../types';
import type { PollutantType, RoadDisplayMode } from '../../types';

// ── Route / AQI color helpers ────────────────────────────────────────

function getRouteColor(route: Route): string {
  if (route.route_type === 'eco') return '#22c55e';
  if (route.route_type === 'balanced') return '#3b82f6';
  return '#f59e0b';
}

function getAQIColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

const toTuple = (wp: Coordinate): L.LatLngTuple => [wp.lat, wp.lng];

// ── Navigation camera helpers ────────────────────────────────────────

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// leaflet-rotate adds setBearing/getBearing; both are feature-detected so the
// map degrades to a stable north-up follow-cam if the plugin ever fails to load.
function getMapBearing(map: L.Map): number {
  try {
    const m = map as unknown as { getBearing?: () => number; options?: { rotate?: boolean } };
    return m.options?.rotate && typeof m.getBearing === 'function' ? (m.getBearing() || 0) : 0;
  } catch {
    return 0;
  }
}
function setMapBearing(map: L.Map, deg: number): void {
  try {
    const m = map as unknown as { setBearing?: (d: number) => void; getBearing?: () => number; options?: { rotate?: boolean } };
    if (!m.options?.rotate || typeof m.setBearing !== 'function') return;
    // Skip redundant rotations (each one re-lays the rotate pane).
    const cur = typeof m.getBearing === 'function' ? (m.getBearing() || 0) : 0;
    if (Math.abs(((deg - cur + 540) % 360) - 180) < 1) return;
    m.setBearing(deg);
  } catch {
    /* ignore */
  }
}

// Tighter zoom when slow, wider when fast — keeps the road ahead in frame.
function zoomForSpeed(speed: number): number {
  if (speed < 0.8) return 17.5;
  if (speed < 1.6) return 17;
  if (speed < 3) return 16.5;
  if (speed < 6) return 16;
  return 15.5;
}
// Bias the camera ahead of the user so they see the road they're walking into.
function lookAheadForSpeed(speed: number): number {
  return Math.max(20, Math.min(120, 25 + speed * 12));
}

// ── CARTO / ESRI raster tile URLs ────────────────────────────────────

const TILE_URLS: Record<string, { light: string; dark: string; attr: string }> = {
  voyager: {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  osm: {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  },
  satellite: {
    light: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '&copy; Esri',
  },
};

// ── Custom marker icons ──────────────────────────────────────────────

// Directional puck: emerald heading chevron (rotated to travel bearing) over a
// solid dot with a soft accuracy halo. The chevron lives in `.puck-rotor` so we
// can spin it without touching Leaflet's own positioning transform on the root.
function createUserIcon(): L.DivIcon {
  return L.divIcon({
    className: 'user-location-marker',
    html: `
      <div style="position:relative;width:30px;height:30px;">
        <div style="position:absolute;inset:-9px;border-radius:9999px;background:rgba(16,185,129,0.16);"></div>
        <div style="position:absolute;inset:-9px;border-radius:9999px;background:rgba(16,185,129,0.22);" class="animate-ping"></div>
        <div class="puck-rotor" style="position:absolute;inset:0;transition:transform .25s ease-out;opacity:0;">
          <svg width="30" height="30" viewBox="0 0 30 30" style="position:absolute;inset:0;">
            <path d="M15 1.5 L22 14 L15 10.5 L8 14 Z" fill="#10b981" stroke="white" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </div>
        <div style="position:absolute;left:50%;top:50%;width:15px;height:15px;margin:-7.5px 0 0 -7.5px;border-radius:9999px;background:#10b981;border:3px solid white;box-shadow:0 1px 5px rgba(0,0,0,.4);"></div>
      </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function createDestIcon(): L.DivIcon {
  return L.divIcon({
    className: 'dest-location-marker',
    html: `
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 12.418 20.597 12.95 21.098a1.5 1.5 0 0 0 2.1 0C15.582 34.597 28 23.333 28 14 28 6.268 21.732 0 14 0z" fill="#ef4444"/>
        <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 12.418 20.597 12.95 21.098a1.5 1.5 0 0 0 2.1 0C15.582 34.597 28 23.333 28 14 28 6.268 21.732 0 14 0z" fill="url(#destGrad)"/>
        <circle cx="14" cy="13" r="5.5" fill="white"/>
        <defs>
          <linearGradient id="destGrad" x1="4" y1="2" x2="24" y2="30" gradientUnits="userSpaceOnUse">
            <stop stop-color="#f87171"/>
            <stop offset="1" stop-color="#dc2626"/>
          </linearGradient>
        </defs>
      </svg>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

// ── HTML escape helper ───────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Props ────────────────────────────────────────────────────────────

interface LeafletMapProps {
  className?: string;
  isDarkMode?: boolean;
  showAQIOverlay?: boolean;
  showAQIStations?: boolean;
  showPOIs?: boolean;
  showMerchants?: boolean;
  highlightGreen?: boolean;
  mapStyle?: 'voyager' | 'osm' | 'satellite';
  activeFilter?: string | null;
  pollutant?: PollutantType;
  forecastHour?: number;
  // 'total' = absolute pollutant vs EPA breakpoints (default)
  // 'delta' = road-only contribution above baseline (highlights per-segment variance)
  roadDisplayMode?: RoadDisplayMode;
  onRoadLayerMeta?: (meta: RoadLayerMeta | null) => void;
  onPlaceSelect?: (poi: POI) => void;
  selectedPoiId?: string | null;
}

// ── Inner map controller ─────────────────────────────────────────────

function MapController({
  showAQIOverlay,
  showAQIStations,
  showPOIs,
  showMerchants,
  highlightGreen,
  activeFilter,
  pollutant,
  forecastHour,
  roadDisplayMode,
  onRoadLayerMeta,
  onPlaceSelect,
  selectedPoiId,
}: Pick<LeafletMapProps, 'showAQIOverlay' | 'showAQIStations' | 'showPOIs' | 'showMerchants' | 'highlightGreen' | 'activeFilter' | 'pollutant' | 'forecastHour' | 'roadDisplayMode' | 'onRoadLayerMeta' | 'onPlaceSelect' | 'selectedPoiId'>) {
  const map = useMap();
  const {
    center,
    userLocation,
    destination,
    destinationName,
    viewTarget,
    setViewTarget,
    routes,
    selectedRoute,
    isCalculatingRoutes,
    setDestination,
    navCameraMode,
    isFollowing,
    recenterNonce,
  } = useMapStore();

  // Live walk state (selectors keep re-renders scoped to what changes).
  const isTracking = useWalkStore((s) => s.isTracking);
  const walkPos = useWalkStore((s) => s.currentPosition);
  const heading = useWalkStore((s) => s.heading);
  const currentSpeed = useWalkStore((s) => s.currentSpeed);
  const navFraction = useWalkStore((s) => s.navProgress?.fraction ?? 0);

  const prevCenterRef = useRef(center);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef(L.layerGroup());
  const traveledLayerRef = useRef(L.layerGroup());
  const lastZoomRef = useRef<number | null>(null);
  const followingRef = useRef(isFollowing);

  const livePos = isTracking ? (walkPos ?? userLocation) : userLocation;

  // Attach layer groups once (traveled overlay sits above the route line)
  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    const traveledLayer = traveledLayerRef.current;
    routeLayer.addTo(map);
    traveledLayer.addTo(map);
    return () => {
      routeLayer.remove();
      traveledLayer.remove();
    };
  }, [map]);

  // Click → set destination; drag → release the follow-cam during a walk
  useMapEvents({
    click(e) {
      if (isCalculatingRoutes) return;
      setDestination({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    dragstart() {
      if (useWalkStore.getState().isTracking && followingRef.current) {
        useMapStore.getState().setFollowing(false);
      }
    },
  });

  // Camera sync (idle, non-tracking only — the follow-cam owns the camera while walking)
  useEffect(() => {
    if (isTracking) {
      prevCenterRef.current = center;
      return;
    }
    if (
      center.lat !== prevCenterRef.current.lat ||
      center.lng !== prevCenterRef.current.lng
    ) {
      try {
        const container = map.getContainer();
        if (!container || !document.body.contains(container)) return;
        if (!isFinite(center.lat) || !isFinite(center.lng)) return;
        map.flyTo([center.lat, center.lng], map.getZoom(), { duration: 0.8 });
        prevCenterRef.current = center;
      } catch { /* map already removed */ }
    }
  }, [center, map, isTracking]);

  // User puck marker — driven by the live walk position while tracking
  useEffect(() => {
    if (livePos) {
      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker([livePos.lat, livePos.lng], {
          icon: createUserIcon(),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        userMarkerRef.current.setLatLng([livePos.lat, livePos.lng]);
      }
      // Spin the chevron to the travel bearing, compensated for any map rotation.
      const el = userMarkerRef.current.getElement();
      const rotor = el?.querySelector('.puck-rotor') as HTMLElement | null;
      if (rotor) {
        if (heading == null) {
          rotor.style.opacity = '0';
        } else {
          rotor.style.opacity = '1';
          rotor.style.transform = `rotate(${(heading - getMapBearing(map) + 360) % 360}deg)`;
        }
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
  }, [livePos, heading, map]);

  // Follow camera: chase the user with look-ahead + speed-zoom + heading-up
  useEffect(() => {
    followingRef.current = isFollowing;
  }, [isFollowing]);

  useEffect(() => {
    if (!isTracking || !isFollowing) return;
    const pos = walkPos ?? userLocation;
    if (!pos || !isFinite(pos.lat) || !isFinite(pos.lng)) return;
    try {
      const container = map.getContainer();
      if (!container || !document.body.contains(container)) return;
    } catch {
      return;
    }

    // Look ahead along the route so the camera leads the puck.
    let target: Coordinate = pos;
    const wps = selectedRoute?.waypoints;
    if (wps && wps.length >= 2) {
      const prog = routeProgress(pos, wps, selectedRoute?.distance_meters);
      if (prog) target = lookAheadPoint(wps, prog.snapped, prog.segIndex, lookAheadForSpeed(currentSpeed));
    }

    // Quantize zoom so it doesn't re-animate every tick.
    const z = zoomForSpeed(currentSpeed);
    const zApply = lastZoomRef.current == null || Math.abs(z - lastZoomRef.current) >= 0.4 ? z : lastZoomRef.current;
    lastZoomRef.current = zApply;

    if (navCameraMode === 'heading' && heading != null) setMapBearing(map, heading);
    else setMapBearing(map, 0);

    const reduce = prefersReducedMotion();
    try {
      map.setView([target.lat, target.lng], zApply, {
        animate: !reduce,
        duration: reduce ? 0 : 0.7,
        easeLinearity: 0.22,
        noMoveStart: true,
      });
    } catch { /* map already removed */ }
  }, [walkPos, userLocation, isTracking, isFollowing, navCameraMode, heading, currentSpeed, selectedRoute, map]);

  // Recenter: snap back to the user when the FAB is tapped
  useEffect(() => {
    if (recenterNonce === 0) return;
    const pos = useWalkStore.getState().currentPosition ?? userLocation;
    if (!pos) return;
    try {
      map.setView([pos.lat, pos.lng], lastZoomRef.current ?? map.getZoom(), { animate: true, duration: 0.5 });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce]);

  // Reset bearing + cached zoom when a walk ends
  useEffect(() => {
    if (!isTracking) {
      lastZoomRef.current = null;
      setMapBearing(map, 0);
    }
  }, [isTracking, map]);

  // Destination marker
  useEffect(() => {
    if (destination) {
      const popupHtml = `<div class="text-sm"><p class="font-semibold">${escapeHtml(destinationName || 'Destination')}</p></div>`;
      if (!destMarkerRef.current) {
        destMarkerRef.current = L.marker([destination.lat, destination.lng], {
          icon: createDestIcon(),
          zIndexOffset: 900,
        })
          .bindPopup(popupHtml, { offset: [0, 0], closeButton: false, className: 'glass-popup' })
          .addTo(map);
      } else {
        destMarkerRef.current.setLatLng([destination.lat, destination.lng]);
        destMarkerRef.current.setPopupContent(popupHtml);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
  }, [destination, destinationName, map]);

  // Fly to viewTarget (search POI select) — suppressed during a walk
  useEffect(() => {
    if (!viewTarget) return;
    if (!isTracking) {
      try {
        const container = map.getContainer();
        if (container && document.body.contains(container) && isFinite(viewTarget.lat) && isFinite(viewTarget.lng)) {
          map.flyTo([viewTarget.lat, viewTarget.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
        }
      } catch { /* map already removed */ }
    }
    setViewTarget(null);
  }, [viewTarget, map, setViewTarget, isTracking]);

  // Route polylines — dark casing + white edge + AQI-colored fill (the static line)
  useEffect(() => {
    routeLayerRef.current.clearLayers();
    if (routes.length === 0) return;

    // Unselected candidates: subtle dashed hints
    for (const route of routes) {
      if (selectedRoute?.id === route.id) continue;
      L.polyline(route.waypoints.map(toTuple), {
        color: getRouteColor(route),
        weight: 4,
        opacity: 0.32,
        dashArray: '3 9',
        lineCap: 'round',
      }).addTo(routeLayerRef.current);
    }

    if (!selectedRoute) return;
    const wps = selectedRoute.waypoints;
    if (wps.length < 2) return;
    const latlngs = wps.map(toTuple);

    // Casing + crisp white inner edge under the colored fill
    L.polyline(latlngs, { color: '#0b3b2e', weight: 11, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayerRef.current);
    L.polyline(latlngs, { color: '#ffffff', weight: 9, opacity: 0.28, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayerRef.current);

    const segments = selectedRoute.vayu_score?.segments;
    if (segments && segments.length > 0) {
      // Base fill covers any gaps between AQI segments
      L.polyline(latlngs, { color: getRouteColor(selectedRoute), weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayerRef.current);
      const total = wps.length;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const nextFrac = i < segments.length - 1 ? segments[i + 1].fraction_along : 1.0;
        const startIdx = Math.max(0, Math.floor(seg.fraction_along * (total - 1)));
        const endIdx = Math.min(total - 1, Math.ceil(nextFrac * (total - 1)));
        if (endIdx <= startIdx) continue;
        const segPoints = latlngs.slice(startIdx, endIdx + 1);
        if (segPoints.length < 2) continue;
        L.polyline(segPoints, { color: getAQIColor(seg.aqi), weight: 6.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayerRef.current);
      }
    } else {
      L.polyline(latlngs, { color: getRouteColor(selectedRoute), weight: 6.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayerRef.current);
    }
  }, [routes, selectedRoute]);

  // Traveled portion dimmed (overpaint the walked part in slate) — updates per tick
  useEffect(() => {
    const grp = traveledLayerRef.current;
    grp.clearLayers();
    if (!isTracking || !selectedRoute || navFraction <= 0.01) return;
    const { traveled } = splitPathAtFraction(selectedRoute.waypoints, navFraction);
    if (traveled.length >= 2) {
      L.polyline(traveled.map(toTuple), { color: '#94a3b8', weight: 6.5, opacity: 0.72, lineCap: 'round', lineJoin: 'round' }).addTo(grp);
    }
  }, [navFraction, selectedRoute, isTracking]);

  // Fit bounds to routes (only when the route set changes, never mid-walk)
  const prevRouteIdsRef = useRef('');
  useEffect(() => {
    if (routes.length === 0 || isTracking) return;
    const ids = routes.map((r) => r.id).join(',');
    if (ids === prevRouteIdsRef.current) return;
    prevRouteIdsRef.current = ids;

    const bounds = L.latLngBounds(
      routes.flatMap((r) => r.waypoints.map(toTuple)),
    );
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
  }, [routes, map, isTracking]);

  // Road pollution overlay. MapLibre GL vector tiles (crisp GPU render, modes switch
  // client-side) handle the current-data Total/Δ views for EVERY pollutant. The
  // viewport-relative Kontras mode and forecast hours stay on the vector layer.
  // VectorGrid (MVT) now renders total / delta / contrast for current data; the dynamic
  // vector layer is only needed for forecast hours (tiles are current-data only).
  const useMvt = (forecastHour || 0) === 0;
  const mvtMeta = useRoadMvtLayer(
    map,
    !!showAQIOverlay && useMvt,
    pollutant || 'aqi',
    roadDisplayMode || 'total',
  );
  const vectorMeta = useRoadPollutionLayer(
    map,
    !!showAQIOverlay && !useMvt,
    pollutant || 'aqi',
    forecastHour || 0,
    roadDisplayMode || 'total',
  );
  const roadMeta = useMvt ? mvtMeta : vectorMeta;

  // Forward road layer meta to parent
  useEffect(() => {
    onRoadLayerMeta?.(roadMeta);
  }, [roadMeta, onRoadLayerMeta]);

  // Interactive WAQI station markers (replaces raster tile overlay)
  useAQIStationLayer(map, !!showAQIStations);

  // Render the POI layer when Places OR Ruang Hijau is on. When only Ruang Hijau is on
  // (Places off), POILayer shows ONLY green spaces (still glowing). Both off → nothing.
  const showPOILayer = showPOIs || highlightGreen;
  return showPOILayer ? (
    <POILayer
      visible={showPOILayer}
      activeFilter={activeFilter}
      onPlaceSelect={onPlaceSelect}
      showMerchants={showMerchants}
      highlightGreen={highlightGreen}
      greenOnly={highlightGreen && !showPOIs}
      selectedPoiId={selectedPoiId}
    />
  ) : null;
}

// ── Navigation overlay controls (recenter + camera mode) ─────────────

function NavControls() {
  const isTracking = useWalkStore((s) => s.isTracking);
  const isFollowing = useMapStore((s) => s.isFollowing);
  const navCameraMode = useMapStore((s) => s.navCameraMode);
  const recenter = useMapStore((s) => s.recenter);
  const toggleNavCameraMode = useMapStore((s) => s.toggleNavCameraMode);

  if (!isTracking) return null;

  return (
    <div
      className="pointer-events-none absolute right-3 z-[1100] flex flex-col gap-2"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 11rem)' }}
    >
      {!isFollowing && (
        <button
          type="button"
          onClick={recenter}
          aria-label="Pusatkan ke lokasi saya"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-primary-600 shadow-lg ring-1 ring-black/5 backdrop-blur transition active:scale-95 dark:bg-gray-900/90 dark:text-primary-400"
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      )}
      <button
        type="button"
        onClick={toggleNavCameraMode}
        aria-label={navCameraMode === 'heading' ? 'Mode arah-perjalanan (ketuk untuk Utara di atas)' : 'Mode Utara di atas (ketuk untuk arah-perjalanan)'}
        className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-lg ring-1 ring-black/5 backdrop-blur transition active:scale-95 dark:bg-gray-900/90 dark:text-gray-200"
      >
        {navCameraMode === 'heading'
          ? <Navigation className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          : <Compass className="h-5 w-5" />}
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function LeafletMap({
  className = '',
  isDarkMode = false,
  showAQIOverlay = false,
  showAQIStations = false,
  showPOIs = true,
  showMerchants = true,
  highlightGreen = false,
  mapStyle = 'voyager',
  activeFilter = null,
  pollutant = 'aqi',
  forecastHour = 0,
  roadDisplayMode = 'total',
  onRoadLayerMeta,
  onPlaceSelect,
  selectedPoiId = null,
}: LeafletMapProps) {
  const { center } = useMapStore();
  const tileConfig = TILE_URLS[mapStyle] || TILE_URLS.voyager;
  const tileUrl = isDarkMode ? tileConfig.dark : tileConfig.light;
  const [internalMeta, setInternalMeta] = useState<RoadLayerMeta | null>(null);

  return (
    <div
      className={className}
      role="region"
      aria-label="Peta kualitas udara interaktif. Ketuk lokasi untuk set tujuan; tahan (long-press) jalan untuk detail paparan."
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        width: '100%',
        height: '100%',
        background: isDarkMode ? '#0f172a' : '#f8fafc',
      }}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={15}
        style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }}
        zoomControl={false}
        attributionControl={false}
        {...({ rotate: true, rotateControl: false, touchRotate: false, bearing: 0 } as Record<string, unknown>)}
      >
        <TileLayer key={tileUrl} url={tileUrl} attribution={tileConfig.attr} />
        <MapController
          showAQIOverlay={showAQIOverlay}
          showAQIStations={showAQIStations}
          showPOIs={showPOIs}
          showMerchants={showMerchants}
          highlightGreen={highlightGreen}
          activeFilter={activeFilter}
          pollutant={pollutant}
          forecastHour={forecastHour}
          roadDisplayMode={roadDisplayMode}
          onRoadLayerMeta={(meta) => {
            setInternalMeta(meta);
            onRoadLayerMeta?.(meta);
          }}
          onPlaceSelect={onPlaceSelect}
          selectedPoiId={selectedPoiId}
        />
      </MapContainer>
      <NavControls />
      {showAQIOverlay && internalMeta && (internalMeta.gcn_applied_count ?? 0) > 0 && (
        <GCNConfidenceLegend
          gcnCount={internalMeta.gcn_applied_count ?? 0}
          totalCount={internalMeta.count}
        />
      )}
      {/* L-3: loading badge while road-aqi fetch is in flight */}
      {showAQIOverlay && internalMeta?.isFetching && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle mr-2" />
          Memuat AQI jalan…
        </div>
      )}
    </div>
  );
}

export { getAQIColor, getRouteColor };
