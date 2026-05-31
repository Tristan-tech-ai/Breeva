import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapStore } from '../../stores/mapStore';
import { useRoadPollutionLayer } from './RoadPollutionLayer';
import { useRoadMvtLayer } from './RoadMvtLayer';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { useAQIStationLayer } from './AQIStationLayer';
import POILayer from './POILayer';
import { GCNConfidenceLegend } from './GCNConfidenceLegend';
import type { POI } from '../../lib/poi-api';
import type { Route } from '../../types';
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

function createUserIcon(): L.DivIcon {
  return L.divIcon({
    className: 'user-location-marker',
    html: `
      <div class="relative w-4 h-4">
        <div class="w-4 h-4 bg-emerald-500 rounded-full border-2 border-white shadow-lg ring-4 ring-emerald-500/20"></div>
        <div class="absolute inset-0 w-4 h-4 bg-emerald-500/30 rounded-full animate-ping"></div>
      </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
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
}: Pick<LeafletMapProps, 'showAQIOverlay' | 'showAQIStations' | 'showPOIs' | 'showMerchants' | 'highlightGreen' | 'activeFilter' | 'pollutant' | 'forecastHour' | 'roadDisplayMode' | 'onRoadLayerMeta' | 'onPlaceSelect'>) {
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
  } = useMapStore();

  const prevCenterRef = useRef(center);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef(L.layerGroup());

  // Attach layer groups once
  useEffect(() => {
    routeLayerRef.current.addTo(map);
    return () => {
      routeLayerRef.current.remove();
    };
  }, [map]);

  // Click → set destination (POI markers have bubblingMouseEvents: false)
  useMapEvents({
    click(e) {
      if (isCalculatingRoutes) return;
      setDestination({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  // Camera sync
  useEffect(() => {
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
  }, [center, map]);

  // User location marker
  useEffect(() => {
    if (userLocation) {
      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
          icon: createUserIcon(),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
  }, [userLocation, map]);

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

  // Fly to viewTarget (search POI select)
  useEffect(() => {
    if (viewTarget) {
      try {
        const container = map.getContainer();
        if (!container || !document.body.contains(container)) return;
        if (!isFinite(viewTarget.lat) || !isFinite(viewTarget.lng)) return;
        map.flyTo([viewTarget.lat, viewTarget.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
      } catch { /* map already removed */ }
      setViewTarget(null);
    }
  }, [viewTarget, map, setViewTarget]);

  // Route polylines
  useEffect(() => {
    routeLayerRef.current.clearLayers();
    if (routes.length === 0) return;

    for (const route of routes) {
      if (selectedRoute?.id === route.id) continue;
      L.polyline(
        route.waypoints.map((wp) => [wp.lat, wp.lng] as L.LatLngTuple),
        { color: getRouteColor(route), weight: 4, opacity: 0.45, dashArray: '8 6' },
      ).addTo(routeLayerRef.current);
    }

    if (selectedRoute) {
      const segments = selectedRoute.vayu_score?.segments;
      if (segments && segments.length > 0 && selectedRoute.waypoints.length >= 2) {
        // Draw colored sub-polylines per VAYU segment AQI
        const wps = selectedRoute.waypoints;
        const totalPoints = wps.length;
        // Draw base route line (subtle) then overlay colored segments
        L.polyline(
          wps.map((wp) => [wp.lat, wp.lng] as L.LatLngTuple),
          { color: getRouteColor(selectedRoute), weight: 5, opacity: 0.3 },
        ).addTo(routeLayerRef.current);

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const nextFrac = i < segments.length - 1 ? segments[i + 1].fraction_along : 1.0;
          const startIdx = Math.max(0, Math.floor(seg.fraction_along * (totalPoints - 1)));
          const endIdx = Math.min(totalPoints - 1, Math.ceil(nextFrac * (totalPoints - 1)));
          if (endIdx <= startIdx) continue;
          const segPoints = wps.slice(startIdx, endIdx + 1).map((wp) => [wp.lat, wp.lng] as L.LatLngTuple);
          if (segPoints.length < 2) continue;
          L.polyline(segPoints, {
            color: getAQIColor(seg.aqi),
            weight: 7,
            opacity: 0.9,
          }).addTo(routeLayerRef.current);
        }
      } else {
        // Fallback: solid single-color polyline
        L.polyline(
          selectedRoute.waypoints.map((wp) => [wp.lat, wp.lng] as L.LatLngTuple),
          { color: getRouteColor(selectedRoute), weight: 7, opacity: 0.9 },
        ).addTo(routeLayerRef.current);
      }
    }
  }, [routes, selectedRoute]);

  // Fit bounds to routes
  const prevRouteIdsRef = useRef('');
  useEffect(() => {
    if (routes.length === 0) return;
    const ids = routes.map((r) => r.id).join(',');
    if (ids === prevRouteIdsRef.current) return;
    prevRouteIdsRef.current = ids;

    const bounds = L.latLngBounds(
      routes.flatMap((r) => r.waypoints.map((wp) => [wp.lat, wp.lng] as L.LatLngTuple)),
    );
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
  }, [routes, map]);

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
    />
  ) : null;
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
        />
      </MapContainer>
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
