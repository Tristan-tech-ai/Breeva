import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapStore } from '../../stores/mapStore';
import { useRoadPollutionLayer } from './RoadPollutionLayer';
import type { RoadLayerMeta } from './RoadPollutionLayer';
import { useAQIStationLayer } from './AQIStationLayer';
import POILayer from './POILayer';
import type { POI } from '../../lib/poi-api';
import type { Route } from '../../types';
import type { PollutantType } from '../../types';

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
      <div class="flex flex-col items-center">
        <div class="w-9 h-9 bg-gradient-to-br from-red-500 to-rose-600 rounded-full border-[3px] border-white shadow-xl flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <div class="w-1.5 h-3 bg-gradient-to-b from-red-500 to-rose-600 -mt-0.5 rounded-b-full"></div>
      </div>`,
    iconSize: [36, 48],
    iconAnchor: [18, 48],
    popupAnchor: [0, -48],
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
  mapStyle?: 'voyager' | 'osm' | 'satellite';
  activeFilter?: string | null;
  pollutant?: PollutantType;
  forecastHour?: number;
  onRoadLayerMeta?: (meta: RoadLayerMeta | null) => void;
  onPlaceSelect?: (poi: POI) => void;
}

// ── Inner map controller ─────────────────────────────────────────────

function MapController({
  showAQIOverlay,
  showAQIStations,
  showPOIs,
  activeFilter,
  pollutant,
  forecastHour,
  onRoadLayerMeta,
  onPlaceSelect,
}: Pick<LeafletMapProps, 'showAQIOverlay' | 'showAQIStations' | 'showPOIs' | 'activeFilter' | 'pollutant' | 'forecastHour' | 'onRoadLayerMeta' | 'onPlaceSelect'>) {
  const map = useMap();
  const {
    center,
    userLocation,
    destination,
    destinationName,
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
      console.log('[vayu flyTo]', { from: [prevCenterRef.current.lat.toFixed(4), prevCenterRef.current.lng.toFixed(4)].join(','), to: [center.lat.toFixed(4), center.lng.toFixed(4)].join(','), zoom: map.getZoom() });
      map.flyTo([center.lat, center.lng], map.getZoom(), { duration: 0.8 });
      prevCenterRef.current = center;
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
      L.polyline(
        selectedRoute.waypoints.map((wp) => [wp.lat, wp.lng] as L.LatLngTuple),
        { color: getRouteColor(selectedRoute), weight: 7, opacity: 0.9 },
      ).addTo(routeLayerRef.current);
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

  // Road pollution overlay (eLichens-style colored polylines)
  const roadMeta = useRoadPollutionLayer(map, !!showAQIOverlay, pollutant || 'aqi', forecastHour || 0);

  // Forward road layer meta to parent
  useEffect(() => {
    onRoadLayerMeta?.(roadMeta);
  }, [roadMeta, onRoadLayerMeta]);

  // Interactive WAQI station markers (replaces raster tile overlay)
  useAQIStationLayer(map, !!showAQIStations);

  return showPOIs ? (
    <POILayer visible={showPOIs} activeFilter={activeFilter} onPlaceSelect={onPlaceSelect} />
  ) : null;
}

// ── Main component ───────────────────────────────────────────────────

export default function LeafletMap({
  className = '',
  isDarkMode = false,
  showAQIOverlay = false,
  showAQIStations = false,
  showPOIs = true,
  mapStyle = 'voyager',
  activeFilter = null,
  pollutant = 'aqi',
  forecastHour = 0,
  onRoadLayerMeta,
  onPlaceSelect,
}: LeafletMapProps) {
  const { center } = useMapStore();
  const tileConfig = TILE_URLS[mapStyle] || TILE_URLS.voyager;
  const tileUrl = isDarkMode ? tileConfig.dark : tileConfig.light;

  return (
    <div
      className={className}
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
          activeFilter={activeFilter}
          pollutant={pollutant}
          forecastHour={forecastHour}
          onRoadLayerMeta={onRoadLayerMeta}
          onPlaceSelect={onPlaceSelect}
        />
      </MapContainer>
    </div>
  );
}

export { getAQIColor, getRouteColor };
