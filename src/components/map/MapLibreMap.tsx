import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '../../stores/mapStore';
import { generateAQIZones } from './AQIOverlay';
import { getPlaceAtPoint } from '../../lib/poi-api';
import type { POI } from '../../lib/poi-api';
import type { Route, Coordinate } from '../../types';

const GEOAPIFY_KEY = '983da66a10e14f909057351679defe36';

// ── Geoapify vector style URLs ───────────────────────────────────────
const STYLE_URLS: Record<string, { light: string; dark: string }> = {
  voyager: {
    light: `https://maps.geoapify.com/v1/styles/osm-bright-smooth/style.json?apiKey=${GEOAPIFY_KEY}`,
    dark: `https://maps.geoapify.com/v1/styles/dark-matter/style.json?apiKey=${GEOAPIFY_KEY}`,
  },
  osm: {
    light: `https://maps.geoapify.com/v1/styles/klokantech-basic/style.json?apiKey=${GEOAPIFY_KEY}`,
    dark: `https://maps.geoapify.com/v1/styles/dark-matter-dark-grey/style.json?apiKey=${GEOAPIFY_KEY}`,
  },
  satellite: {
    light: `https://maps.geoapify.com/v1/styles/osm-bright-smooth/style.json?apiKey=${GEOAPIFY_KEY}`,
    dark: `https://maps.geoapify.com/v1/styles/dark-matter/style.json?apiKey=${GEOAPIFY_KEY}`,
  },
};

// ── Route colors ─────────────────────────────────────────────────────
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

// ── Generate circle polygon for AQI zones ────────────────────────────
function circlePolygon(center: Coordinate, radiusMeters: number, points = 48): [number, number][] {
  const coords: [number, number][] = [];
  const R = 6371e3;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusMeters / R) * Math.cos(angle);
    const dLng = (radiusMeters / (R * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
    coords.push([center.lng + (dLng * 180) / Math.PI, center.lat + (dLat * 180) / Math.PI]);
  }
  return coords;
}

// ── Props ────────────────────────────────────────────────────────────
interface MapLibreMapProps {
  className?: string;
  isDarkMode?: boolean;
  showAQIOverlay?: boolean;
  showPOIs?: boolean;
  mapStyle?: 'voyager' | 'osm' | 'satellite';
  activeFilter?: string | null;
  onPlaceSelect?: (poi: POI) => void;
}

export default function MapLibreMap({
  className = '',
  isDarkMode = false,
  showAQIOverlay = false,
  showPOIs = true,
  mapStyle = 'voyager',
  activeFilter = null,
  onPlaceSelect,
}: MapLibreMapProps) {
  const {
    center,
    userLocation,
    destination,
    destinationName,
    routes,
    selectedRoute,
    currentAQI,
    setDestination,
    isCalculatingRoutes,
  } = useMapStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const prevCenterRef = useRef(center);
  const styleLoadedRef = useRef(false);
  const poiLayerNamesRef = useRef<string[]>([]);

  // Track if routes were added so we can clean up
  const [mapReady, setMapReady] = useState(false);

  // ── Resolved style URL ───────────────────────────────────────────
  const styleUrl = useMemo(() => {
    const styles = STYLE_URLS[mapStyle] || STYLE_URLS.voyager;
    return isDarkMode ? styles.dark : styles.light;
  }, [mapStyle, isDarkMode]);

  // ── Initialize map ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [center.lng, center.lat],
      zoom: 15,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      styleLoadedRef.current = true;
      mapRef.current = map;

      // Discover POI layer names in the style
      const layers = map.getStyle().layers;
      const poiLayers = layers
        .filter((l) => /poi|place_of_worship|amenity/i.test(l.id) && l.type === 'symbol')
        .map((l) => l.id);
      poiLayerNamesRef.current = poiLayers;

      // Add pointer cursor on POI hover
      for (const layerId of poiLayers) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }

      setMapReady(true);
    });

    // Clean up on unmount
    return () => {
      styleLoadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Style switching (dark mode / map style) ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    // setStyle triggers 'style.load' which we handle to restore layers
    styleLoadedRef.current = false;
    map.once('style.load', () => {
      styleLoadedRef.current = true;
      // Re-discover POI layers after style change
      const layers = map.getStyle().layers;
      const poiLayers = layers
        .filter((l) => /poi|place_of_worship|amenity/i.test(l.id) && l.type === 'symbol')
        .map((l) => l.id);
      poiLayerNamesRef.current = poiLayers;

      for (const layerId of poiLayers) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }

      // Force re-render of data layers
      setMapReady(false);
      requestAnimationFrame(() => setMapReady(true));
    });

    map.setStyle(styleUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // ── POI click handler (100% synced with vector tiles) ─────────────
  const handleMapClick = useCallback(
    async (e: maplibregl.MapMouseEvent) => {
      const map = mapRef.current;
      if (!map || isCalculatingRoutes) return;

      // 1. Query rendered POI features at click point
      if (onPlaceSelect && poiLayerNamesRef.current.length > 0) {
        const features = map.queryRenderedFeatures(e.point, {
          layers: poiLayerNamesRef.current,
        });

        if (features.length > 0) {
          const f = features[0];
          const props = f.properties || {};
          const geom = f.geometry;
          let lng = e.lngLat.lng;
          let lat = e.lngLat.lat;
          if (geom.type === 'Point') {
            [lng, lat] = geom.coordinates as [number, number];
          }

          const poi: POI = {
            id: `vt-${props.name || ''}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
            name: props.name || props['name:en'] || props['name:latin'] || 'Unknown Place',
            category: props.class || props.subclass || props.type || 'place',
            coordinate: { lat, lng },
            types: [props.class, props.subclass, props.type].filter(Boolean) as string[],
          };
          onPlaceSelect(poi);
          return;
        }
      }

      // 2. API fallback — for clicks near POIs not yet in view query (rare)
      if (onPlaceSelect && map.getZoom() >= 16) {
        try {
          const poi = await getPlaceAtPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          if (poi) {
            onPlaceSelect(poi);
            return;
          }
        } catch { /* fall through */ }
      }

      // 3. No POI — set destination
      setDestination({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    },
    [onPlaceSelect, setDestination, isCalculatingRoutes],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on('click', handleMapClick);
    return () => { map.off('click', handleMapClick); };
  }, [handleMapClick]);

  // ── POI visibility toggle ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const visibility = showPOIs ? 'visible' : 'none';
    for (const layerId of poiLayerNamesRef.current) {
      try { map.setLayoutProperty(layerId, 'visibility', visibility); } catch { /* ignore */ }
    }
  }, [showPOIs, mapReady]);

  // ── POI category filter ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || !showPOIs) return;

    for (const layerId of poiLayerNamesRef.current) {
      try {
        if (!activeFilter) {
          // No filter — show all POIs
          map.setFilter(layerId, null);
        } else {
          // Map our filter category to Geoapify vector tile class names
          const classMap: Record<string, string[]> = {
            restaurant: ['restaurant', 'fast_food', 'food_court'],
            cafe: ['cafe', 'coffee_shop', 'coffee'],
            hotel: ['hotel', 'guest_house', 'hostel', 'motel'],
            park: ['park', 'garden', 'playground', 'nature_reserve'],
            shop: ['shop', 'supermarket', 'convenience', 'mall', 'commercial', 'marketplace'],
            mosque: ['mosque', 'place_of_worship'],
            atm: ['atm', 'bank'],
            gas: ['fuel', 'gas_station', 'charging_station'],
          };
          const allowed = classMap[activeFilter] || [];
          if (allowed.length > 0) {
            map.setFilter(layerId, ['in', ['get', 'class'], ['literal', allowed]]);
          }
        }
      } catch { /* ignore if layer doesn't support filter */ }
    }
  }, [activeFilter, showPOIs, mapReady]);

  // ── Camera sync ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (
      center.lat !== prevCenterRef.current.lat ||
      center.lng !== prevCenterRef.current.lng
    ) {
      map.flyTo({ center: [center.lng, center.lat], zoom: map.getZoom(), duration: 800 });
      prevCenterRef.current = center;
    }
  }, [center]);

  // ── User location marker ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocation) {
      if (!userMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'user-marker-ml';
        el.innerHTML = `
          <div class="relative w-4 h-4">
            <div class="w-4 h-4 bg-emerald-500 rounded-full border-2 border-white shadow-lg ring-4 ring-emerald-500/20"></div>
            <div class="absolute inset-0 w-4 h-4 bg-emerald-500/30 rounded-full animate-ping"></div>
          </div>`;
        userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([userLocation.lng, userLocation.lat])
          .addTo(map);
      } else {
        userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
  }, [userLocation]);

  // ── Destination marker ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (destination) {
      if (!destMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'dest-marker-ml';
        el.innerHTML = `
          <div class="flex flex-col items-center">
            <div class="w-9 h-9 bg-gradient-to-br from-red-500 to-rose-600 rounded-full border-[3px] border-white shadow-xl flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <div class="w-1.5 h-3 bg-gradient-to-b from-red-500 to-rose-600 -mt-0.5 rounded-b-full"></div>
          </div>`;
        destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([destination.lng, destination.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25, closeButton: false, className: 'glass-popup-ml' })
              .setHTML(`<div class="text-sm"><p class="font-semibold">${escapeHtml(destinationName || 'Destination')}</p></div>`)
          )
          .addTo(map);
      } else {
        destMarkerRef.current.setLngLat([destination.lng, destination.lat]);
        destMarkerRef.current.getPopup()?.setHTML(
          `<div class="text-sm"><p class="font-semibold">${escapeHtml(destinationName || 'Destination')}</p></div>`
        );
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
  }, [destination, destinationName]);

  // ── Route polylines ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    // Clean up old route layers/sources
    for (const id of ['route-bg', 'route-selected', ...routes.map((_, i) => `route-${i}`)]) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }

    if (routes.length === 0) return;

    // Non-selected routes (dashed, lighter)
    routes.forEach((route, i) => {
      if (selectedRoute?.id === route.id) return;
      const id = `route-${i}`;
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: route.waypoints.map((wp) => [wp.lng, wp.lat]),
          },
        },
      });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        paint: {
          'line-color': getRouteColor(route),
          'line-width': 4,
          'line-opacity': 0.45,
          'line-dasharray': [2, 1.5],
        },
      });
    });

    // Selected route (solid, bold, on top)
    if (selectedRoute) {
      map.addSource('route-selected', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: selectedRoute.waypoints.map((wp) => [wp.lng, wp.lat]),
          },
        },
      });
      map.addLayer({
        id: 'route-selected',
        type: 'line',
        source: 'route-selected',
        paint: {
          'line-color': getRouteColor(selectedRoute),
          'line-width': 7,
          'line-opacity': 0.9,
        },
      });
    }
  }, [routes, selectedRoute, mapReady]);

  // ── Route fitter ─────────────────────────────────────────────────
  const prevRouteIdsRef = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || routes.length === 0) return;

    const ids = routes.map((r) => r.id).join(',');
    if (ids === prevRouteIdsRef.current) return;
    prevRouteIdsRef.current = ids;

    const bounds = new maplibregl.LngLatBounds();
    for (const route of routes) {
      for (const wp of route.waypoints) {
        bounds.extend([wp.lng, wp.lat]);
      }
    }
    map.fitBounds(bounds, { padding: 50, maxZoom: 16, animate: true });
  }, [routes]);

  // ── AQI overlay circles ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    // Clean up existing AQI layers
    const existing = map.getStyle().layers.filter((l) => l.id.startsWith('aqi-zone-'));
    for (const layer of existing) {
      map.removeLayer(layer.id);
      if (map.getSource(layer.id)) map.removeSource(layer.id);
    }

    if (!showAQIOverlay || !currentAQI || !userLocation) return;

    const zones = generateAQIZones(userLocation, currentAQI.aqi);
    zones.forEach((zone, i) => {
      const id = `aqi-zone-${i}`;
      const color = getAQIColor(zone.aqi);
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [circlePolygon(zone.center, zone.radius)],
          },
        },
      });
      // Insert AQI layers below route layers
      map.addLayer({
        id,
        type: 'fill',
        source: id,
        paint: {
          'fill-color': color,
          'fill-opacity': 0.15,
        },
      });
      map.addLayer({
        id: `${id}-outline`,
        type: 'line',
        source: id,
        paint: {
          'line-color': color,
          'line-width': 1,
          'line-opacity': 0.3,
        },
      });
    });
  }, [showAQIOverlay, currentAQI, userLocation, mapReady]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        background: isDarkMode ? '#0f172a' : '#f8fafc',
      }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export { getAQIColor, getRouteColor };
