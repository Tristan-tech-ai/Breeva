import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapStore } from '../../stores/mapStore';
import { AQICircles, generateAQIZones } from './AQIOverlay';
import POILayer from './POILayer';
import type { POI } from '../../lib/poi-api';
import { getPlaceAtPoint } from '../../lib/poi-api';
import type { Route } from '../../types';

// Fix Leaflet default icon issue with bundlers
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

// Custom marker icons
const userIcon = L.divIcon({
  className: 'user-marker',
  html: `<div class="relative">
    <div class="w-4 h-4 bg-primary-500 rounded-full border-2 border-white shadow-lg ring-4 ring-primary-500/20"></div>
    <div class="absolute inset-0 w-4 h-4 bg-primary-500/30 rounded-full animate-ping"></div>
  </div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const destinationIcon = L.divIcon({
  className: 'destination-marker',
  html: `<div class="flex flex-col items-center">
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
});

// Map controller to sync state — only moves camera when `center` is explicitly changed,
// NOT on every GPS location update (which caused constant jittering).
function MapController() {
  const map = useMap();
  const { center, zoom } = useMapStore();
  const prevCenter = useRef(center);

  useEffect(() => {
    if (
      center.lat !== prevCenter.current.lat ||
      center.lng !== prevCenter.current.lng
    ) {
      map.flyTo([center.lat, center.lng], zoom, { duration: 0.8 });
      prevCenter.current = center;
    }
  }, [center, zoom, map]);

  return null;
}

// Map click handler — with POI tap fallback
// When user taps a tile-rendered POI label (raster text), there may be no
// Breeva marker on top. This handler checks local POIs first (instant,
// pixel-based) then falls back to a quick API lookup before setting destination.
function MapClickHandler({ poisRef, onPlaceSelect }: {
  poisRef: React.MutableRefObject<POI[]>;
  onPlaceSelect?: (poi: POI) => void;
}) {
  const { setDestination, isCalculatingRoutes } = useMapStore();
  const map = useMap();

  useMapEvents({
    click: async (e) => {
      if (isCalculatingRoutes) return;

      // 1. Check local fetched POIs within 40px of tap (instant)
      if (onPlaceSelect && poisRef.current.length > 0) {
        const clickPt = map.latLngToContainerPoint(e.latlng);
        let nearest: POI | null = null;
        let nearestDist = 40; // px
        for (const poi of poisRef.current) {
          const poiPt = map.latLngToContainerPoint(
            L.latLng(poi.coordinate.lat, poi.coordinate.lng)
          );
          const dist = Math.hypot(clickPt.x - poiPt.x, clickPt.y - poiPt.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = poi;
          }
        }
        if (nearest) {
          onPlaceSelect(nearest);
          return;
        }
      }

      // 2. API fallback at z16+ — catch tile POIs missing from local dataset
      if (onPlaceSelect && map.getZoom() >= 16) {
        try {
          const poi = await getPlaceAtPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
          if (poi) {
            onPlaceSelect(poi);
            return;
          }
        } catch { /* fall through */ }
      }

      // 3. No POI found → set destination
      setDestination({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return null;
}

// Auto-fit map bounds to show all routes
function RouteFitter({ routes }: { routes: Route[] }) {
  const map = useMap();
  const prevRouteIds = useRef<string>('');

  useEffect(() => {
    const ids = routes.map((r) => r.id).join(',');
    if (ids === prevRouteIds.current || routes.length === 0) return;
    prevRouteIds.current = ids;

    // Collect all waypoints from all routes
    const allPoints: [number, number][] = [];
    for (const route of routes) {
      for (const wp of route.waypoints) {
        allPoints.push([wp.lat, wp.lng]);
      }
    }
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
    }
  }, [routes, map]);

  return null;
}

// Route colors by type
function getRouteColor(route: Route): string {
  if (route.route_type === 'eco') return '#22c55e';   // green
  if (route.route_type === 'balanced') return '#3b82f6'; // blue
  return '#f59e0b'; // amber for fast
}

function getAQIColor(aqi: number): string {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

interface LeafletMapProps {
  className?: string;
  isDarkMode?: boolean;
  showAQIOverlay?: boolean;
  showPOIs?: boolean;
  mapStyle?: 'voyager' | 'osm' | 'satellite';
  activeFilter?: string | null;
  onPlaceSelect?: (poi: POI) => void;
}

export default function LeafletMap({ className = '', isDarkMode = false, showAQIOverlay = false, showPOIs = false, mapStyle = 'voyager', activeFilter = null, onPlaceSelect }: LeafletMapProps) {
  const {
    center,
    userLocation,
    destination,
    destinationName,
    routes,
    selectedRoute,
    currentAQI,
  } = useMapStore();

  // Shared POI ref for map-click fallback handler
  const poisRef = useRef<POI[]>([]);

  const [zones] = useState(() =>
    currentAQI && userLocation ? generateAQIZones(userLocation, currentAQI.aqi) : []
  );

  // Tile URLs — full tiles with labels & POI names (visuals handled by tiles,
  // interactivity handled by tap-to-identify API lookup)
  const tileUrls: Record<string, { url: string; attribution: string }> = {
    voyager: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
    osm: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
  };

  // Dark mode overrides
  const darkTiles: Record<string, { url: string; attribution: string }> = {
    voyager: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
    osm: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri &copy; <a href="https://openstreetmap.org/copyright">OSM</a>',
    },
  };

  const tiles = isDarkMode
    ? (darkTiles[mapStyle] || darkTiles.voyager)
    : (tileUrls[mapStyle] || tileUrls.voyager);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={15}
        zoomControl={false}
        className="h-full w-full z-0"
        style={{ width: '100%', height: '100%', background: isDarkMode ? '#0f172a' : '#f8fafc' }}
      >
        <TileLayer
          key={`tile-${mapStyle}-${isDarkMode}`}
          url={tiles.url}
          attribution={tiles.attribution}
          maxZoom={20}
        />

        <MapController />
        <MapClickHandler poisRef={poisRef} onPlaceSelect={onPlaceSelect} />

        {/* AQI overlay zones */}
        {showAQIOverlay && zones.length > 0 && (
          <AQICircles zones={zones} />
        )}

        {/* POI data layer — fetches POIs for tap-to-identify, no visual rendering */}
        {showPOIs && (
          <POILayer
            visible={showPOIs}
            activeFilter={activeFilter}
            poisRef={poisRef}
          />
        )}

        {/* User location marker */}
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup className="glass-popup">
              <div className="text-center text-sm">
                <p className="font-semibold text-gray-900 dark:text-white">You are here</p>
                {currentAQI && (
                  <p className="text-xs mt-1">
                    AQI:{' '}
                    <span className="font-bold" style={{ color: getAQIColor(currentAQI.aqi) }}>
                      {currentAQI.aqi}
                    </span>
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {/* Destination marker */}
        {destination && (
          <Marker position={[destination.lat, destination.lng]} icon={destinationIcon}>
            <Popup>
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-white">{destinationName || 'Destination'}</p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Route polylines — render non-selected routes first, selected on top */}
        {routes
          .filter((route) => selectedRoute?.id !== route.id)
          .map((route) => (
            <Polyline
              key={route.id}
              positions={route.waypoints.map((wp) => [wp.lat, wp.lng] as [number, number])}
              color={getRouteColor(route)}
              weight={4}
              opacity={0.45}
              dashArray="8 6"
            />
          ))}
        {selectedRoute && (
          <Polyline
            key={selectedRoute.id}
            positions={selectedRoute.waypoints.map((wp) => [wp.lat, wp.lng] as [number, number])}
            color={getRouteColor(selectedRoute)}
            weight={7}
            opacity={0.9}
          />
        )}

        {/* Fit map to show all routes when they change */}
        {routes.length > 0 && <RouteFitter routes={routes} />}
      </MapContainer>
    </div>
  );
}

export { getAQIColor, getRouteColor };
